/**
 * 伤害配置（用户实测口径，2026-08-15 定稿）
 * 公式：伤害 = min(30, round(30 × (1 − e^(−Σ存活HP ÷ K))))
 * 平局双方各扣固定值
 */

export const damageConfig = {
  /** 玩家初始血量 */
  initialHp: 30,
  /** 单局最大扣血（封顶） */
  maxDamage: 30,
  /** 平局固定伤害 */
  drawDamage: 3,
  /** 饱和曲线系数 K（MVP 量级；将来数值膨胀到几百上千血时调大） */
  saturationK: 40,
} as const;

/** 胜方存活卡剩余血量总和 → 伤害（饱和曲线） */
export function damageFromSurvivingHp(totalHp: number): number {
  const raw = damageConfig.maxDamage * (1 - Math.exp(-totalHp / damageConfig.saturationK));
  return Math.min(damageConfig.maxDamage, Math.round(raw));
}
