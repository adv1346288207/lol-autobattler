/**
 * 伤害配置
 * 公式（用户 2026-08-15 实测口径，形状不变）：伤害 = min(30, round(30 × (1 − e^(−Σ存活HP ÷ K))))
 * 平局双方各扣固定值。
 *
 * K 的取值与英雄数值量级绑定：
 * - 旧占位卡量级（2~12 血）时 K=40，1000 局平均 11.8 回合
 * - LoL 英雄卡池引入法力/护盾后，胜方存活血量总和上升约 1.4 倍，
 *   同样的 K 会让单场失败扣血过重、对局缩短到 8.7 回合，玩家来不及升到 4/5 级商店。
 * - 按"伤害 ∝ 1/K"把 K 同比放大到 66，恢复原有节奏（锚点见 tests/state.test.ts）。
 *   这是 LoL 改编阶段 G 的数值调优，公式形状与扣血封顶 30 均未改动。
 */

export const damageConfig = {
  /** 玩家初始血量 */
  initialHp: 30,
  /** 单局最大扣血（封顶） */
  maxDamage: 30,
  /** 平局固定伤害 */
  drawDamage: 3,
  /** 饱和曲线系数 K（随英雄数值量级调整；当前对应 5~12 血英雄卡池） */
  saturationK: 66,
} as const;

/** 胜方存活卡剩余血量总和 → 伤害（饱和曲线） */
export function damageFromSurvivingHp(totalHp: number): number {
  const raw = damageConfig.maxDamage * (1 - Math.exp(-totalHp / damageConfig.saturationK));
  return Math.min(damageConfig.maxDamage, Math.round(raw));
}
