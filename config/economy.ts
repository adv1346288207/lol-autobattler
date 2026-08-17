/**
 * 经济配置
 * 金币阶梯：R1=2，前10回合每回合+1，之后每回合+2，封顶20
 * 经验/升级（2026-08-17 用户机制修正）：经验只是升级进度；
 *   升级时差多少经验就一次性付多少金币（1经验=1金币）；经验≥所需则免费升级
 */

export const economyConfig = {
  /** 第 1 回合发放 */
  goldStart: 2,
  /** 前期每回合增量（第 2~10 回合） */
  goldEarlyStep: 1,
  /** 前期回合数 */
  goldEarlyRounds: 10,
  /** 后期每回合增量（第 11 回合起） */
  goldLateStep: 2,
  /** 金币封顶 */
  goldCap: 20,
  /** 每回合自动获得经验 */
  baseExpPerRound: 1,
  /**
   * 升级所需经验（下标=当前等级，值为升到下一级所需经验）
   * 1→2: 2 ｜ 2→3: 8（用户举例确认）
   * 3→4: 12 ｜ 4→5: 16 为占位值，待用户在《当前数值.md》中确认
   */
  upgradeExpCosts: [0, 2, 8, 12, 16],
} as const;

/** 第 round 回合发放的金币数 */
export function goldForRound(round: number): number {
  if (round <= economyConfig.goldEarlyRounds) {
    return economyConfig.goldStart + (round - 1) * economyConfig.goldEarlyStep;
  }
  const earlyLast = economyConfig.goldStart + (economyConfig.goldEarlyRounds - 1) * economyConfig.goldEarlyStep; // 11
  return Math.min(economyConfig.goldCap, earlyLast + (round - economyConfig.goldEarlyRounds) * economyConfig.goldLateStep);
}

/** 从 shopLevel 升到 shopLevel+1 所需经验（5 级满返回 null） */
export function expToUpgrade(shopLevel: number): number | null {
  if (shopLevel >= economyConfig.upgradeExpCosts.length) return null; // 5 级满
  return economyConfig.upgradeExpCosts[shopLevel]!;
}

/** 升级还需补的金币（差多少经验付多少金币；经验≥所需则为 0） */
export function goldToUpgrade(shopLevel: number, currentExp: number): number | null {
  const cost = expToUpgrade(shopLevel);
  if (cost === null) return null;
  return Math.max(0, cost - currentExp);
}
