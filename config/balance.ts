/**
 * 通用平衡参数（法力/效果取整等公共规则）
 * 英雄个体数值在 config/cards.ts；羁绊数值在 config/traits.ts。
 */
import type { StarPair } from "../core/state";

export const balanceConfig = {
  /** 普通攻击后获得法力 */
  manaPerAttack: 10,
  /** 受到至少 1 点"实际生命伤害"后获得法力（被护盾完全吸收不给） */
  manaPerDamageTaken: 5,
  /** 比例/倍数计算向下取整后，原始效果为正但结果为 0 时至少结算 1 点 */
  minPositiveEffect: 1,
  /** 单场战斗单个英雄的最大施法次数保护（防死循环） */
  maxCastsPerUnit: 200,
} as const;

/** 取星级数值：level 1 → pair[0]，level 2 → pair[1] */
export function pickStar(pair: StarPair | undefined, level: 1 | 2, fallback = 0): number {
  if (!pair) return fallback;
  return pair[level - 1] ?? pair[0];
}

/** 按比例缩放并向下取整；原始为正但取整为 0 时至少 1 点 */
export function amplify(value: number, amp = 0): number {
  const raw = value * (1 + amp);
  const floored = Math.floor(raw);
  if (value > 0 && floored < balanceConfig.minPositiveEffect) return balanceConfig.minPositiveEffect;
  return floored;
}

/** 按比例取值并向下取整；原始为正但取整为 0 时至少 1 点 */
export function ratioOf(value: number, ratio: number): number {
  const floored = Math.floor(value * ratio);
  if (value > 0 && floored < balanceConfig.minPositiveEffect) return balanceConfig.minPositiveEffect;
  return floored;
}
