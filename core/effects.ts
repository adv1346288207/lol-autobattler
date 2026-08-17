/**
 * 效果注册表（词条扩展点）
 * 技能 = 数据：{ trigger, effect, params }；effect 在此查实现
 * 规则：技能数值 × 卡牌等级（level 2 = 金卡 → 兰 +1经验变 +2、龙野 1次刷新变 2次）
 */
import type { PlayerState } from "./state";

export type EffectFn = (player: PlayerState, params: Record<string, number>, level: 1 | 2) => void;

export const effectRegistry: Record<string, EffectFn> = {
  /** 兰：每回合额外 +1 经验（金卡 +2） */
  gain_exp: (p, params, level) => {
    const n = params.n ?? 1;
    p.exp += n * level;
  },
  /** 龙野：每回合获得免费刷新（金卡 2 次；每回合清零不累积） */
  free_refresh: (p, params, level) => {
    const n = params.n ?? 1;
    p.freeRefresh += n * level;
  },
};
