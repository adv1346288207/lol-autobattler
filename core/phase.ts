/**
 * 回合阶段状态机
 * 阶段流转：shop → pair → battle → damage →（回合数+1）→ shop
 * M1：实现 beginRound（商店阶段开局）；pair/battle/damage 在 M2 接入
 */
import type { BattleEvent, GameState, Phase } from "./state";
import { alivePlayers } from "./state";
import type { Rng } from "./rng";
import { applyRoundIncome } from "./economy";
import { rollShop } from "./shop";
import { triggerForPlayer } from "./bus";
import { pairPlayers } from "./matchmaking";
import { simulateBattle } from "./battle";
import { applyBattleResult } from "./damage";
import { gameConfig } from "../config/game";

export const PHASE_ORDER: Phase[] = ["shop", "pair", "battle", "damage"];

export function nextPhase(phase: Phase): Phase {
  if (phase === "ended") return "ended";
  const i = PHASE_ORDER.indexOf(phase);
  if (i === -1) throw new Error(`nextPhase: 未知阶段 ${phase}`);
  return PHASE_ORDER[(i + 1) % PHASE_ORDER.length]!;
}

/**
 * 商店阶段开局（每回合开始调用）：
 * 1. 发金币（阶梯制）+ 自动 +1 经验
 * 2. freeRefresh 清零（龙野不累积）
 * 3. turn_start 被动触发（兰 +经验 / 龙野 +免费刷新）
 * 4. 商店自动刷新 3 张
 */
export function beginRound(state: GameState, rng: Rng): void {
  state.battleLog = [];
  for (const p of state.players) {
    if (p.eliminated) continue;
    applyRoundIncome(p, state.round);
    p.freeRefresh = 0;
    p.shopDone = false;
    for (const c of p.hand) c.isFreeRefreshUsed = false;
    for (const c of p.board) {
      if (c) c.isFreeRefreshUsed = false;
    }
    triggerForPlayer(p, "turn_start");
    rollShop(state, rng, p);
  }
}

/**
 * 完整回合流转（M2）：所有存活玩家结束商店阶段后调用
 * pair → battle → damage →（终局判定）→ 下一回合 shop
 * @returns 本回合战斗事件日志（beginRound 会在下一回合清空 state.battleLog，因此以返回值传递）
 */
export function resolveRound(state: GameState, rng: Rng): BattleEvent[] {
  if (state.phase === "ended") return [];

  state.phase = "pair";
  const pairings = pairPlayers(state, rng);

  state.phase = "battle";
  const log: BattleEvent[] = [];
  for (const pair of pairings) {
    if (pair.b === null) continue; // 轮空不受伤
    const events = simulateBattle(state, pair.a, pair.b);
    log.push(...events);
    applyBattleResult(state, pair.a, pair.b, events);
  }
  state.battleLog = log;

  state.phase = "damage";
  const alive = alivePlayers(state);
  if (alive.length <= 1 || state.round >= gameConfig.maxRounds) {
    endGame(state);
    return log;
  }
  state.round += 1;
  state.phase = "shop";
  beginRound(state, rng); // 新回合：清空 battleLog
  return log;
}

/** 终局结算：最后 1 人第 1 名；回合上限强制结算按血量降序排剩余名次 */
function endGame(state: GameState): void {
  state.phase = "ended";
  const alive = alivePlayers(state);
  if (alive.length === 1) {
    alive[0]!.rank = 1;
    return;
  }
  if (alive.length === 0) return; // 双人平局双死：名次已在出局时按顺序记录
  const sorted = [...alive].sort((x, y) => y.hp - x.hp || x.id - y.id);
  sorted.forEach((p, i) => {
    p.rank = i + 1;
  });
}
