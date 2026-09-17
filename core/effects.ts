/**
 * 效果层
 * 1) 商店阶段效果注册表（旧体系保留：兰 +经验 / 龙野 +免费刷新）
 * 2) 战斗效果原语：伤害 / 治疗 / 护盾 / 控制 / 增益 / 破盾 / 回蓝 / 被动
 *
 * 规则：
 * - 伤害先扣护盾再扣生命；治疗不超过 maxHp；死亡只触发一次
 * - 被护盾完全吸收的伤害不给受击法力
 * - 伤害与死亡事件在此产生，击杀/阵亡类羁绊由 core/battle.ts 在结算后触发
 */
import type { PassiveConfig, PassiveTrigger, PlayerState, StatusId, StatusInstance } from "./state";
import type { BattleContext, BattleUnit } from "./battle";
import { balanceConfig, pickStar, amplify } from "../config/balance";

/* ══════════════ 1. 商店阶段效果注册表（词条扩展点） ══════════════ */

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

/* ══════════════ 2. 战斗效果原语 ══════════════ */

export interface DamageResult {
  /** 实际造成的总伤害（护盾吸收 + 生命伤害） */
  dealt: number;
  /** 被护盾吸收的部分 */
  absorbed: number;
  /** 实际扣掉的生命 */
  hpDamage: number;
  killed: boolean;
}

function statusValue(unit: BattleUnit, id: StatusId): number {
  let sum = 0;
  for (const st of unit.statuses) if (st.id === id) sum += st.value;
  return sum;
}

/** 伤害减免（状态 + 战士低血减伤），上限 90% */
export function effectiveDamageReduction(unit: BattleUnit): number {
  let dr = statusValue(unit, "damage_reduction");
  if (unit.lowHpThreshold > 0 && unit.maxHp > 0 && unit.hp / unit.maxHp <= unit.lowHpThreshold) {
    dr += unit.lowHpDamageReduction;
  }
  return Math.min(0.9, dr);
}

export function gainMana(ctx: BattleContext, unit: BattleUnit, amount: number, reason: string): void {
  if (!unit.alive || amount === 0 || unit.maxMana <= 0) return;
  const before = unit.mana;
  unit.mana = Math.max(0, Math.min(unit.maxMana, unit.mana + amount));
  if (unit.mana === before) return;
  ctx.events.push({ type: "MANA_CHANGE", who: unit.uid, before, after: unit.mana, reason });
}

export function spendMana(ctx: BattleContext, unit: BattleUnit, amount: number, reason: string): void {
  const before = unit.mana;
  unit.mana = Math.max(0, unit.mana - amount);
  if (unit.mana === before) return;
  ctx.events.push({ type: "MANA_CHANGE", who: unit.uid, before, after: unit.mana, reason });
}

export function applyShield(
  ctx: BattleContext,
  source: BattleUnit,
  target: BattleUnit,
  amount: number,
): number {
  if (!target.alive || amount <= 0) return 0;
  const shielded = amplify(amount, target.healShieldAmp);
  target.shield += shielded;
  ctx.events.push({
    type: "SHIELD_GAIN",
    source: source.uid,
    target: target.uid,
    amount: shielded,
    totalShield: target.shield,
  });
  return shielded;
}

export function applyHeal(
  ctx: BattleContext,
  source: BattleUnit,
  target: BattleUnit,
  amount: number,
): number {
  if (!target.alive || amount <= 0) return 0;
  const healed = Math.min(amplify(amount, target.healShieldAmp), target.maxHp - target.hp);
  if (healed <= 0) return 0;
  target.hp += healed;
  ctx.events.push({
    type: "HEAL",
    source: source.uid,
    target: target.uid,
    amount: healed,
    remainingHp: target.hp,
  });
  return healed;
}

export function applyStatus(
  ctx: BattleContext,
  source: BattleUnit,
  target: BattleUnit,
  id: StatusId,
  duration: number,
  value = 0,
): void {
  if (!target.alive || duration <= 0) return;
  const existing = target.statuses.find((s) => s.id === id);
  if (existing) {
    existing.duration = Math.max(existing.duration, duration);
    existing.value = Math.max(existing.value, value);
    existing.source = source.uid;
  } else {
    const st: StatusInstance = { id, duration, value, source: source.uid };
    target.statuses.push(st);
  }
  ctx.events.push({ type: "STATUS_APPLY", source: source.uid, target: target.uid, status: id, duration });
}

export function removeStatus(ctx: BattleContext, unit: BattleUnit, status: StatusInstance, silent = false): void {
  const i = unit.statuses.indexOf(status);
  if (i >= 0) unit.statuses.splice(i, 1);
  if (!silent) ctx.events.push({ type: "STATUS_REMOVE", target: unit.uid, status: status.id });
}

/** 清除全部控制状态（艾克回溯） */
export function clearControl(ctx: BattleContext, unit: BattleUnit): void {
  for (const st of [...unit.statuses]) {
    if (st.id === "stun" || st.id === "charm") removeStatus(ctx, unit, st);
  }
}

export function applyAttackBuff(ctx: BattleContext, unit: BattleUnit, amount: number): void {
  if (amount === 0) return;
  void ctx;
  unit.atk = Math.max(0, unit.atk + amount);
}

/** 破盾：清除目标全部护盾并产出 SHIELD_BREAK */
export function breakShield(ctx: BattleContext, source: BattleUnit | null, target: BattleUnit): number {
  if (!target.alive || target.shield <= 0) return 0;
  const removed = target.shield;
  target.shield = 0;
  ctx.events.push({ type: "SHIELD_BREAK", source: source?.uid ?? null, target: target.uid, amount: removed });
  ctx.pendingShieldBreaks.push(target);
  return removed;
}

/** 统一伤害入口：普攻与技能伤害都必须经过这里 */
export function dealDamage(
  ctx: BattleContext,
  source: BattleUnit | null,
  target: BattleUnit,
  rawAmount: number,
): DamageResult {
  const empty: DamageResult = { dealt: 0, absorbed: 0, hpDamage: 0, killed: false };
  if (!target.alive || rawAmount <= 0) return empty;

  const dr = effectiveDamageReduction(target);
  let amount = Math.floor(rawAmount * (1 - dr));
  if (rawAmount > 0 && amount < balanceConfig.minPositiveEffect) amount = balanceConfig.minPositiveEffect;

  let absorbed = 0;
  if (target.shield > 0) {
    absorbed = Math.min(target.shield, amount);
    target.shield -= absorbed;
    amount -= absorbed;
  }
  target.hp -= amount;
  if (target.hp < 0) target.hp = 0;

  ctx.events.push({
    type: "DAMAGE",
    source: source ? source.uid : null,
    target: target.uid,
    amount: absorbed + amount,
    absorbed,
    remainingHp: target.hp,
  });
  if (absorbed > 0 && target.shield <= 0) {
    ctx.events.push({ type: "SHIELD_BREAK", source: source?.uid ?? null, target: target.uid, amount: absorbed });
    ctx.pendingShieldBreaks.push(target);
  }

  // 只有实际生命伤害才给受击法力（被护盾全吸收不给）
  if (amount >= 1) gainMana(ctx, target, balanceConfig.manaPerDamageTaken, "hurt");

  if (target.hp > 0) return { dealt: absorbed + amount, absorbed, hpDamage: amount, killed: false };

  if (tryLethalSave(ctx, target)) {
    return { dealt: absorbed + amount, absorbed, hpDamage: amount, killed: false };
  }
  target.alive = false;
  target.hp = 0;
  ctx.events.push({ type: "DEATH", who: target.uid, killer: source ? source.uid : null });
  ctx.pendingDeaths.push({ unit: target, killer: source });
  return { dealt: absorbed + amount, absorbed, hpDamage: amount, killed: true };
}

/* ══════════════ 3. 战斗被动 ══════════════ */

function passiveKey(passive: PassiveConfig, index: number): string {
  return `${index}:${passive.trigger}:${passive.effect}`;
}

/** 致命伤回溯（艾克）：取消本次死亡 */
function tryLethalSave(ctx: BattleContext, unit: BattleUnit): boolean {
  for (const [i, passive] of unit.passives.entries()) {
    if (passive.trigger !== "on_lethal_damage" || passive.effect !== "revive_rewind") continue;
    const key = passiveKey(passive, i);
    if (passive.oncePerBattle && (unit.passiveUses[key] ?? 0) > 0) continue;
    if ((unit.passiveUses[key] ?? 0) > 0) continue;
    unit.passiveUses[key] = (unit.passiveUses[key] ?? 0) + 1;
    const ratio = pickStar(passive.ratio, unit.level, 0.35);
    const mana = pickStar(passive.value, unit.level, 0);
    unit.hp = Math.max(1, Math.floor(unit.maxHp * ratio));
    unit.revived = true;
    clearControl(ctx, unit);
    ctx.events.push({ type: "REVIVE", who: unit.uid, hp: unit.hp });
    gainMana(ctx, unit, mana, "revive");
    return true;
  }
  return false;
}

/**
 * 触发单位的战斗被动。
 * @param victim 击杀类被动的目标（佛耶戈继承攻击力用）
 */
export function triggerPassives(
  ctx: BattleContext,
  unit: BattleUnit,
  trigger: PassiveTrigger,
  victim: BattleUnit | null = null,
): void {
  for (const [i, passive] of unit.passives.entries()) {
    if (passive.trigger !== trigger) continue;
    const key = passiveKey(passive, i);
    const uses = unit.passiveUses[key] ?? 0;
    if (passive.oncePerBattle && uses > 0) continue;
    if (passive.maxStacks !== undefined && uses >= passive.maxStacks) continue;
    switch (passive.effect) {
      case "attack_buff": {
        applyAttackBuff(ctx, unit, pickStar(passive.value, unit.level));
        break;
      }
      case "mana_gain": {
        gainMana(ctx, unit, pickStar(passive.value, unit.level), `passive:${passive.trigger}`);
        break;
      }
      case "heal": {
        applyHeal(ctx, unit, unit, pickStar(passive.value, unit.level));
        break;
      }
      case "shield": {
        applyShield(ctx, unit, unit, pickStar(passive.value, unit.level));
        break;
      }
      case "steal_attack": {
        if (!victim) break;
        const ratio = pickStar(passive.ratio, unit.level, 0);
        applyAttackBuff(ctx, unit, Math.floor(victim.baseAtk * ratio));
        break;
      }
      case "revive_rewind":
        break; // 由 tryLethalSave 处理
    }
    unit.passiveUses[key] = uses + 1;
  }
}
