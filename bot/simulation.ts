/**
 * 全 AI 对局运行器（CLI --auto / --batch 与测试共用）
 */
import { createGame, type GameState } from "../core/state";
import { createRng } from "../core/rng";
import { beginRound, resolveRound } from "../core/phase";
import { runBotTurn, createBot } from "./random";

/** 跑一整局全 AI 对局（seed 即对局种子与 AI 种子来源） */
export function runAutoGame(seed: number): GameState {
  const state = createGame(seed);
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

export interface BatchStats {
  games: number;
  totalMs: number;
  totalRounds: number;
  winCount: number[]; // 按玩家 id 索引的夺冠次数
}

/** 批量跑 N 局并汇总统计（AI 测试用） */
export function runBatch(startSeed: number, games: number): BatchStats {
  const winCount = new Array<number>(8).fill(0);
  let totalRounds = 0;
  const t0 = Date.now();
  for (let i = 0; i < games; i++) {
    const state = runAutoGame(startSeed + i);
    const winner = state.players.find((p) => p.rank === 1);
    if (winner) winCount[winner.id]! += 1;
    totalRounds += state.round;
  }
  return {
    games,
    totalMs: Date.now() - t0,
    totalRounds,
    winCount,
  };
}

export function formatBatchStats(stats: BatchStats): string {
  const lines: string[] = [];
  lines.push(`═══ 批量模拟：${stats.games} 局 ═══`);
  lines.push(
    `总耗时 ${stats.totalMs}ms（平均 ${(stats.totalMs / stats.games).toFixed(2)}ms/局）`,
  );
  lines.push(`平均回合数 ${(stats.totalRounds / stats.games).toFixed(1)}`);
  lines.push(
    "夺冠分布: " +
      stats.winCount
        .map((n, i) => `玩家${i}: ${n} 局`)
        .join("  |  "),
  );
  return lines.join("\n");
}
