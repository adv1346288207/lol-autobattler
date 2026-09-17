/**
 * 全 AI 对局运行器（CLI --auto / --batch 与测试共用）
 *
 * 批量统计用于平衡验证：
 * - 夺冠分布、平均回合数、单局战斗事件数
 * - 每名英雄 / 每个羁绊的"前四率"与"胜率"升降（lift = 该条件下的比例 ÷ 全体基线）
 *   lift > 1 表示该英雄/羁绊让名次更好，< 1 表示偏弱。
 */
import { createGame, type GameState } from "../core/state";
import { createRng } from "../core/rng";
import { beginRound, resolveRound } from "../core/phase";
import { runBotTurn, createBot } from "./random";
import { CARD_BY_ID } from "../config/cards";
import { TRAIT_BY_ID, type TraitId } from "../config/traits";
import { pickMapForSeed } from "../config/maps";
import { traitCountsOfConfigIds } from "../core/traits";

/** 跑一整局全 AI 对局（seed 即对局种子、AI 种子与地图来源） */
export function runAutoGame(seed: number): GameState {
  // 批量模拟里让三张地图均匀出现，避免平衡数据只覆盖一张图
  const state = createGame(seed, pickMapForSeed(seed));
  const rng = createRng(seed);
  const bots = new Map(state.players.map((p) => [p.id, createBot(seed, p.id)]));
  beginRound(state, rng);
  let guard = 0;
  for (;;) {
    if (guard++ >= 200) {
      throw new Error(`runAutoGame: seed=${seed} 对局未在保护次数内结束`);
    }
    for (const p of [...state.players]) {
      if (!p.eliminated && !p.shopDone) {
        runBotTurn(state, rng, p.id, bots.get(p.id)!);
      }
    }
    resolveRound(state, rng);
    if (state.phase === "ended") return state;
  }
}

/** 出现 X 次的样本里，进入前四 / 夺冠的比例 */
export interface LiftStat {
  /** 出现（上阵）的玩家局数 */
  appearances: number;
  top4: number;
  wins: number;
}

export interface BatchStats {
  games: number;
  totalMs: number;
  totalRounds: number;
  winCount: number[]; // 按玩家 id 索引的夺冠次数
  /** 英雄进入前四名的局数（旧指标，保留兼容） */
  heroTop4: Map<string, number>;
  /** 羁绊进入前四名的局数（旧指标，保留兼容） */
  traitTop4: Map<TraitId, number>;
  /** 单局最大战斗事件数 */
  maxBattleEvents: number;
  /** 英雄 lift 明细 */
  heroStats: Map<string, LiftStat>;
  /** 羁绊 lift 明细 */
  traitStats: Map<TraitId, LiftStat>;
  /** 装备 lift 明细 */
  equipStats: Map<string, LiftStat>;
  /** 上阵卡带装备的平均比例 */
  equipRate: number;
  /** 全体玩家的前四率基线（= top4 次数 / 总人次） */
  baselineTop4: number;
  baselineWin: number;
}

function bump(map: Map<string, LiftStat>, key: string, top4: boolean, win: boolean): void {
  const s = map.get(key) ?? { appearances: 0, top4: 0, wins: 0 };
  s.appearances += 1;
  if (top4) s.top4 += 1;
  if (win) s.wins += 1;
  map.set(key, s);
}

/** 汇总一局的每名玩家：上阵英雄与激活羁绊 */
function collectGame(
  state: GameState,
  heroStats: Map<string, LiftStat>,
  traitStats: Map<TraitId, LiftStat>,
  heroTop4: Map<string, number>,
  traitTop4: Map<TraitId, number>,
  equipStats: Map<string, LiftStat>,
): { top4: number; wins: number; players: number; equipCount: number; boardCount: number } {
  let top4Count = 0;
  let winCount = 0;
  let players = 0;
  let equipCount = 0;
  let boardCount = 0;
  for (const p of state.players) {
    if (p.rank === null) continue;
    players += 1;
    const top4 = p.rank <= 4;
    const win = p.rank === 1;
    if (top4) top4Count += 1;
    if (win) winCount += 1;

    const ids = p.board.filter((c) => c !== null).map((c) => c!.configId);
    const uniqueHeroes = new Set(ids);
    for (const id of uniqueHeroes) {
      bump(heroStats, id, top4, win);
      if (top4) heroTop4.set(id, (heroTop4.get(id) ?? 0) + 1);
    }

    // 装备使用情况：上阵卡里带武器的比例 + 每件装备的强度
    for (const c of p.board) {
      if (!c) continue;
      boardCount += 1;
      for (const e of c.equips) {
        equipCount += 1;
        bump(equipStats, e.configId, top4, win);
      }
    }

    const counts = traitCountsOfConfigIds(ids);
    for (const [trait, count] of counts) {
      const cfg = TRAIT_BY_ID.get(trait);
      if (!cfg || count < cfg.thresholds[0]) continue;
      bump(traitStats, trait, top4, win);
      if (top4) traitTop4.set(trait, (traitTop4.get(trait) ?? 0) + 1);
    }
  }
  return { top4: top4Count, wins: winCount, players, equipCount, boardCount };
}

/** 批量跑 N 局并汇总统计 */
export function runBatch(startSeed: number, games: number): BatchStats {
  const winCount = new Array<number>(8).fill(0);
  let totalRounds = 0;
  let maxBattleEvents = 0;
  let top4Total = 0;
  let winTotal = 0;
  let playerTotal = 0;
  const heroTop4 = new Map<string, number>();
  const traitTop4 = new Map<TraitId, number>();
  const equipStats = new Map<string, LiftStat>();
  let equipTotal = 0;
  let boardTotal = 0;
  const heroStats = new Map<string, LiftStat>();
  const traitStats = new Map<TraitId, LiftStat>();
  const t0 = Date.now();

  for (let i = 0; i < games; i++) {
    const state = runAutoGame(startSeed + i);
    const winner = state.players.find((p) => p.rank === 1);
    if (winner) winCount[winner.id]! += 1;
    totalRounds += state.round;
    maxBattleEvents = Math.max(maxBattleEvents, state.battleLog.length);
    const agg = collectGame(state, heroStats, traitStats, heroTop4, traitTop4, equipStats);
    equipTotal += agg.equipCount;
    boardTotal += agg.boardCount;
    top4Total += agg.top4;
    winTotal += agg.wins;
    playerTotal += agg.players;
  }

  return {
    games,
    totalMs: Date.now() - t0,
    totalRounds,
    winCount,
    heroTop4,
    traitTop4,
    maxBattleEvents,
    heroStats,
    traitStats,
    equipStats,
    equipRate: boardTotal > 0 ? equipTotal / boardTotal : 0,
    baselineTop4: playerTotal > 0 ? top4Total / playerTotal : 0.5,
    baselineWin: playerTotal > 0 ? winTotal / playerTotal : 0.125,
  };
}

/** lift = 有条件比例 ÷ 全体基线（1.0 = 与平均持平） */
export function liftOf(stat: LiftStat, baseline: number, key: "top4" | "wins"): number {
  if (stat.appearances === 0 || baseline <= 0) return 0;
  return stat[key] / stat.appearances / baseline;
}

function liftTable(
  title: string,
  rows: { name: string; stat: LiftStat }[],
  stats: BatchStats,
  minGames: number,
): string[] {
  const out: string[] = [title];
  const usable = rows
    .filter((r) => r.stat.appearances >= minGames)
    .sort((a, b) => liftOf(b.stat, stats.baselineTop4, "top4") - liftOf(a.stat, stats.baselineTop4, "top4"));
  for (const r of usable) {
    const t4 = liftOf(r.stat, stats.baselineTop4, "top4");
    const win = liftOf(r.stat, stats.baselineWin, "wins");
    const bar = t4 >= 1 ? "▲".repeat(Math.min(4, Math.round((t4 - 1) * 8))) : "▼".repeat(Math.min(4, Math.round((1 - t4) * 8)));
    out.push(
      `  ${r.name.padEnd(6, "　")} 前四率 ${((r.stat.top4 / r.stat.appearances) * 100).toFixed(0).padStart(3)}%  ` +
        `lift ${t4.toFixed(2)} ${bar.padEnd(4)}  胜率lift ${win.toFixed(2)}  样本 ${r.stat.appearances}`,
    );
  }
  return out;
}

export function formatBatchStats(stats: BatchStats): string {
  const lines: string[] = [];
  lines.push(`═══ 批量模拟：${stats.games} 局 ═══`);
  lines.push(`总耗时 ${stats.totalMs}ms（平均 ${(stats.totalMs / stats.games).toFixed(2)}ms/局）`);
  lines.push(`平均回合数 ${(stats.totalRounds / stats.games).toFixed(1)}`);
  lines.push(
    "夺冠分布: " + stats.winCount.map((n, i) => `玩家${i}: ${n} 局`).join("  |  "),
  );
  lines.push(`单局最大战斗事件数 ${stats.maxBattleEvents}`);
  lines.push(
    `基线：前四率 ${(stats.baselineTop4 * 100).toFixed(1)}%　夺冠率 ${(stats.baselineWin * 100).toFixed(1)}%`,
  );

  const totalTop4 = stats.games * 4;
  const heroRows = [...stats.heroStats.entries()].map(([id, stat]) => ({
    name: CARD_BY_ID.get(id)?.name ?? id,
    stat,
  }));
  const traitRows = [...stats.traitStats.entries()].map(([id, stat]) => ({
    name: TRAIT_BY_ID.get(id)?.name ?? id,
    stat,
  }));

  lines.push(...liftTable("── 英雄强度（按前四率 lift 排序）──", heroRows, stats, Math.max(20, stats.games * 0.05)));
  lines.push(...liftTable("── 羁绊强度（按前四率 lift 排序）──", traitRows, stats, Math.max(20, stats.games * 0.05)));

  const equipRows = [...stats.equipStats.entries()].map(([id, stat]) => ({
    name: CARD_BY_ID.get(id)?.name ?? id,
    stat,
  }));
  lines.push(...liftTable("── 装备强度（按前四率 lift 排序）──", equipRows, stats, Math.max(20, stats.games * 0.05)));
  lines.push(`上阵卡带装备比例 ${(stats.equipRate * 100).toFixed(1)}%`);

  lines.push("── 出现次数（前四名阵容中的次数）──");
  const appearance = [...stats.heroTop4.entries()]
    .map(([id, n]) => ({ name: CARD_BY_ID.get(id)?.name ?? id, n }))
    .sort((a, b) => b.n - a.n);
  lines.push(
    "  英雄: " + appearance.map((r) => `${r.name} ${((r.n / totalTop4) * 100).toFixed(0)}%`).join("  "),
  );
  return lines.join("\n");
}
