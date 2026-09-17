/**
 * 羁绊统计与效果（地区 + 职业）
 * - 统计按"场上不同 configId"去重；英雄复制器与旧卡没有地区/职业，自然不计数
 * - 开战效果统一在 BATTLE_START 之后触发，并产出 TRAIT_TRIGGER 事件
 * - 所有数值来自 config/traits.ts，本文件不出现魔法数字
 */
import type { BattleContext, BattleUnit } from "./battle";
import {
  TRAIT_LIST,
  tierIndexFor,
  type Profession,
  type TraitId,
} from "../config/traits";
import { CARD_BY_ID } from "../config/cards";
import { createRng } from "./rng";
import { applyAttackBuff, applyHeal, applyShield, gainMana } from "./effects";

/** 该羁绊在本场战斗中的档位（-1 = 未激活），key = `${owner}:${traitId}` */
export function traitKey(owner: number, id: TraitId): string {
  return `${owner}:${id}`;
}

export function tierOf(ctx: BattleContext, owner: number, id: TraitId): number {
  return ctx.traitTiers.get(traitKey(owner, id)) ?? -1;
}

/** 按 configId 列表统计羁绊人数（同名只计 1 次；无地区/职业的卡不计） */
export function traitCountsOfConfigIds(configIds: readonly string[]): Map<TraitId, number> {
  const seen = new Set<string>();
  const counts = new Map<TraitId, number>();
  for (const id of configIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const cfg = CARD_BY_ID.get(id);
    if (!cfg) continue;
    if (cfg.region) counts.set(cfg.region, (counts.get(cfg.region) ?? 0) + 1);
    for (const prof of cfg.professions) counts.set(prof, (counts.get(prof) ?? 0) + 1);
  }
  return counts;
}

/** 场上不同 configId 的羁绊人数统计 */
export function traitCountsFor(units: BattleUnit[]): Map<TraitId, number> {
  return traitCountsOfConfigIds(units.map((u) => u.configId));
}

export interface ActiveTrait {
  id: TraitId;
  count: number;
  tier: number;
}

/** 某玩家当前激活的羁绊（按配置表固定顺序，保证确定性/UI 稳定） */
export function activeTraitsFor(units: BattleUnit[]): ActiveTrait[] {
  const counts = traitCountsFor(units);
  const out: ActiveTrait[] = [];
  for (const trait of TRAIT_LIST) {
    const count = counts.get(trait.id) ?? 0;
    const tier = tierIndexFor(trait.id, count);
    if (tier >= 0) out.push({ id: trait.id, count, tier });
  }
  return out;
}

/** 开战羁绊结算（对某一方所有存活单位） */
export function applyBattleStartTraits(ctx: BattleContext, owner: number): void {
  const myUnits = ctx.units.filter((u) => u.owner === owner && u.alive);
  if (myUnits.length === 0) return;
  const counts = traitCountsFor(myUnits);

  for (const trait of TRAIT_LIST) {
    const count = counts.get(trait.id) ?? 0;
    const tier = tierIndexFor(trait.id, count);
    if (tier < 0) continue;
    ctx.traitTiers.set(traitKey(owner, trait.id), tier);
    const affected: number[] = [];
    const hasProfession = (u: BattleUnit, prof: Profession): boolean => {
      const cfg = CARD_BY_ID.get(u.configId);
      return cfg?.professions.includes(prof) ?? false;
    };

    switch (trait.id) {
      case "vanguard": {
        const ratio = trait.params.maxHpRatio[tier]!;
        for (const u of myUnits) {
          if (!hasProfession(u, "vanguard")) continue;
          const before = u.maxHp;
          const next = Math.floor(u.maxHp * (1 + ratio));
          u.maxHp = next;
          u.hp += next - before; // 开战满血：只补差值，不做比例回满
          if (tier === 1) {
            applyShield(ctx, u, u, Math.floor(u.maxHp * trait.params.startShieldRatio));
          }
          affected.push(u.uid);
        }
        break;
      }
      case "warrior": {
        const ratio = trait.params.atkRatio[tier]!;
        for (const u of myUnits) {
          if (!hasProfession(u, "warrior")) continue;
          u.atk = Math.floor(u.atk * (1 + ratio));
          if (tier === 1) {
            u.lowHpThreshold = trait.params.lowHpThreshold;
            u.lowHpDamageReduction = trait.params.lowHpDamageReduction;
          }
          affected.push(u.uid);
        }
        break;
      }
      case "mage": {
        const amp = trait.params.skillAmp[tier]!;
        for (const u of myUnits) {
          if (!hasProfession(u, "mage")) continue;
          u.skillAmp += amp;
          if (tier === 1) u.firstCastManaRefund += trait.params.firstCastManaRefund;
          affected.push(u.uid);
        }
        break;
      }
      case "marksman": {
        const every = trait.params.extraAttackEvery[tier]!;
        const ratio = trait.params.extraAttackRatio[tier]!;
        for (const u of myUnits) {
          if (!hasProfession(u, "marksman")) continue;
          u.extraAttackEvery = every;
          u.extraAttackRatio = ratio;
          affected.push(u.uid);
        }
        break;
      }
      case "assassin": {
        const amp = trait.params.firstSkillAmp[tier]!;
        for (const u of myUnits) {
          if (!hasProfession(u, "assassin")) continue;
          u.targetRule = "backmost"; // 开战锁定敌方后排
          u.firstSkillAmp += amp;
          ctx.events.push({ type: "JUMP", who: u.uid, toRow: "back" });
          affected.push(u.uid);
        }
        break;
      }
      case "support": {
        const amp = trait.params.healShieldAmp[tier]!;
        for (const u of myUnits) {
          if (!hasProfession(u, "support")) continue;
          u.healShieldAmp += amp;
          if (tier === 1) u.copyBuffToExtraAlly = trait.params.copyBuffToExtraAlly;
          affected.push(u.uid);
        }
        break;
      }
      case "demacia": {
        const shield = trait.params.startShield[tier]!;
        for (const u of myUnits) {
          applyShield(ctx, u, u, shield);
          if (tier === 1) u.shieldBreakAtkBuff = trait.params.shieldBreakAtkBuff;
          affected.push(u.uid);
        }
        break;
      }
      case "noxus": {
        const buff = trait.params.killAtkBuff[tier]!;
        for (const u of myUnits) {
          u.onKillAtkBuff = buff;
          if (tier === 1) u.onKillHealRatio = trait.params.killHealRatio;
          affected.push(u.uid);
        }
        break;
      }
      case "ionia": {
        const mana = trait.params.startMana[tier]!;
        for (const u of myUnits) {
          gainMana(ctx, u, mana, "ionia");
          if (tier === 1) u.castManaRefund += trait.params.castManaRefund;
          affected.push(u.uid);
        }
        break;
      }
      case "piltover_zaun": {
        const n = Math.min(trait.params.buffCount[tier]!, myUnits.length);
        // 派生 RNG：seed + 玩家 ID + 回合数，确定性且不消耗战斗 RNG 主序列
        const rng = createRng((ctx.state.seed ^ (owner * 0x9e3779b9) ^ (ctx.state.round * 0x85ebca6b)) >>> 0);
        const pool = [...myUnits].sort((a, b) => a.uid - b.uid);
        const chosen: BattleUnit[] = [];
        const taken = new Set<number>();
        let guard = 0;
        while (chosen.length < n && guard++ < 200) {
          const idx = Math.floor(rng() * pool.length);
          const u = pool[Math.min(idx, pool.length - 1)]!;
          if (taken.has(u.uid)) continue;
          taken.add(u.uid);
          chosen.push(u);
        }
        for (const u of chosen.sort((a, b) => a.uid - b.uid)) {
          u.atk += trait.params.buffAtk;
          u.maxHp += trait.params.buffHp;
          u.hp += trait.params.buffHp;
          affected.push(u.uid);
        }
        if (tier === 1) {
          for (const u of myUnits) {
            u.skillAmp += trait.params.skillAmp;
            if (!affected.includes(u.uid)) affected.push(u.uid);
          }
        }
        break;
      }
      case "shadow_isles": {
        for (const u of myUnits) {
          u.soulAtkBuff = trait.params.allyDeathAtkBuff;
          u.maxSoulStacks = trait.params.maxStacks[tier]!;
          affected.push(u.uid);
        }
        break;
      }
    }

    ctx.events.push({
      type: "TRAIT_TRIGGER",
      owner,
      trait: trait.id,
      tier,
      targets: affected,
    });
  }
}

/** 击杀触发：诺克萨斯成长 */
export function handleKill(ctx: BattleContext, killer: BattleUnit, victim: BattleUnit): void {
  const tier = tierOf(ctx, killer.owner, "noxus");
  if (tier < 0) return;
  applyAttackBuff(ctx, killer, killer.onKillAtkBuff);
  if (killer.onKillHealRatio > 0) {
    applyHeal(ctx, killer, killer, Math.floor(killer.maxHp * killer.onKillHealRatio));
  }
  ctx.events.push({
    type: "TRAIT_TRIGGER",
    owner: killer.owner,
    trait: "noxus",
    tier,
    targets: [killer.uid],
  });
  void victim;
}

/** 友方阵亡触发：暗影岛灵魂层数 */
export function handleAllyDeath(ctx: BattleContext, dead: BattleUnit): void {
  const owner = dead.owner;
  const tier = tierOf(ctx, owner, "shadow_isles");
  if (tier < 0) return;
  const deaths = (ctx.deathsByOwner.get(owner) ?? 0) + 1;
  ctx.deathsByOwner.set(owner, deaths);
  if (tier === 0 && deaths > 1) return; // 2 人档只认首名阵亡
  const targets: number[] = [];
  for (const u of ctx.units) {
    if (!u.alive || u.owner !== owner) continue;
    if (u.soulStacks >= u.maxSoulStacks) continue;
    u.soulStacks += 1;
    applyAttackBuff(ctx, u, u.soulAtkBuff);
    targets.push(u.uid);
  }
  if (targets.length === 0) return;
  ctx.events.push({ type: "TRAIT_TRIGGER", owner, trait: "shadow_isles", tier, targets });
}

/** 破盾触发：德玛西亚 4 人档 */
export function handleShieldBreak(ctx: BattleContext, unit: BattleUnit): void {
  if (unit.shieldBreakAtkBuff <= 0 || unit.shieldBroken) return;
  unit.shieldBroken = true;
  applyAttackBuff(ctx, unit, unit.shieldBreakAtkBuff);
  const tier = tierOf(ctx, unit.owner, "demacia");
  ctx.events.push({
    type: "TRAIT_TRIGGER",
    owner: unit.owner,
    trait: "demacia",
    tier: Math.max(tier, 0),
    targets: [unit.uid],
  });
}

/** 施法触发：艾欧尼亚回蓝 / 法师首次施法回蓝 */
export function handleSkillCast(ctx: BattleContext, caster: BattleUnit): void {
  if (caster.castManaRefund > 0) {
    gainMana(ctx, caster, caster.castManaRefund, "ionia");
    const tier = tierOf(ctx, caster.owner, "ionia");
    ctx.events.push({
      type: "TRAIT_TRIGGER",
      owner: caster.owner,
      trait: "ionia",
      tier: Math.max(tier, 0),
      targets: [caster.uid],
    });
  }
  if (caster.castCount === 1 && caster.firstCastManaRefund > 0) {
    gainMana(ctx, caster, caster.firstCastManaRefund, "mage");
    const tier = tierOf(ctx, caster.owner, "mage");
    ctx.events.push({
      type: "TRAIT_TRIGGER",
      owner: caster.owner,
      trait: "mage",
      tier: Math.max(tier, 0),
      targets: [caster.uid],
    });
  }
}
