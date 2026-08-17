/** 对局全局参数 */

export const gameConfig = {
  /** 同局人数（1 玩家 + 7 AI；联机后 AI 换远程玩家） */
  playerCount: 8,
  /** 回合上限：到 60 回合未分胜负 → 按血量从高到低排名 */
  maxRounds: 60,
  /** 单场战斗行动步数上限（用户确认 2026-08-17：3000 步） */
  maxBattleSteps: 3000,
} as const;
