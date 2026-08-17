/**
 * 回合阶段状态机
 * 阶段流转：shop → pair → battle → damage →（回合数+1）→ shop
 * M1：实现 beginRound（商店阶段开局）；pair/battle/damage 在 M2 接入
 */
import type { BattleEvent, GameState, Pairing, Phase } from "./state";
import { alivePlayers } from "./state";
import type { Rng } from "./rng";
import { applyRoundIncome, autoUpgradeIfPossible } from "./economy";
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
    autoUpgradeIfPossible(p); // 经验≥所需 → 自动连续升级（升级后再刷商店，吃新等级概率）
    rollShop(state, rng, p);
  }
}

/**
 * 准备阶段：所有存活玩家结束商店阶段后调用，产出配对
 * （Web 在此刻即可展示"对手是谁 + 先手后手"；a=先手、b=后手）
 * @returns 本回合全部配对（含轮空）
 */
export function prepareBattle(state: GameState, rng: Rng): Pairing[] {
  if (state.phase !== "shop") throw new Error(`prepareBattle: 当前阶段 ${state.phase}，应在商店阶段`);
  state.phase = "pair";
  const pairings = pairPlayers(state, rng);
  state.pendingPairings = pairings;
  return pairings;
}

/**
 * 战斗阶段：按 pendingPairings 逐场结算 → 伤害 → 淘汰 → 终局判定 → 下一回合
 * @returns 本回合战斗事件日志
 */
export function resolveBattle(state: GameState, rng: Rng): BattleEvent[] {
  const pairings = state.pendingPairings;
  if (!pairings) throw new Error("resolveBattle: 未准备配对（先调用 prepareBattle）");
  state.pendingPairings = null;
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

/**
 * 完整回合流转（CLI/AI 测试用）：prepareBattle + resolveBattle 一气呵成
 */
export function resolveRound(state: GameState, rng: Rng): BattleEvent[] {
  prepareBattle(state, rng);
  return resolveBattle(state, rng);
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
