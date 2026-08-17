/**
 * 经济配置（用户实测口径，2026-08-15 定稿）
 * 金币阶梯：R1=2，前10回合每回合+1，之后每回合+2，封顶20
 * 经验：每回合自动+1；升级消耗经验；2金买1经验
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
  /** 买经验：2 金 = 1 经验 */
  goldPerExp: 2,
  /** 升级消耗经验（下标=当前等级，值为升到下一级所需经验）：1→2 需 2、2→3 需 4、3→4 需 6、4→5 需 8 */
  upgradeExpCosts: [0, 2, 4, 6, 8],
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
