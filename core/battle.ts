/**
 * 战斗模拟（法力 / 技能 / 状态 / 羁绊版）
 *
 * 关键约束：
 * - 战斗只在双方棋盘的【快照副本】上进行，绝不污染持久棋盘
 * - 行动顺序：位置 1→6 循环，每个位置"我方行动 → 敌方行动"，死亡/眩晕跳过
 * - 单个单位行动顺序：处理行动前状态 → 眩晕跳过 → 满法力施法 / 普攻 → 结算 → 触发击杀/阵亡羁绊
 * - 随机数全部来自本场战斗的派生 RNG（seed + 回合 + 双方 ID），同 seed 结果完全一致
 * - 战斗 RNG 与对局商店 RNG 完全隔离，不会扰动抽卡序列
 */
import type {
  ActiveSkillConfig,
  BattleEvent,
  BattleUnitSnapshot,
  CardInstance,
  EnemyTargetRule,
  GameState,
  PassiveConfig,
  SkillStep,
  StatusInstance,
} from "./state";
import { createRng, type Rng } from "./rng";
import { totalAtk, totalHp } from "./state";
import { CARD_BY_ID } from "../config/cards";
import { balanceConfig, pickStar, amplify, ratioOf } from "../config/balance";
import { gameConfig } from "../config/game";
import { basicAttackTarget, selectTargets } from "./targeting";
import { MAP_BY_ID } from "../config/maps";
import {
  applyAttackBuff,
  applyHeal,
  applyShield,
  applyStatus,
  breakShield,
  dealDamage,
  gainMana,
  removeStatus,
  spendMana,
  triggerPassives,
} from "./effects";
import {
  applyBattleStartTraits,
  handleAllyDeath,
  handleKill,
  handleShieldBreak,
  handleSkillCast,
  type ActiveTrait,
  activeTraitsFor,
} from "./traits";

/* ══════════════ 战斗单位与上下文 ══════════════ */

export interface BattleUnit {
  uid: number;
  owner: number;
  configId: string;
  level: 1 | 2;
  position: number; // 1~6
  atk: number;
  /** 开战基础攻击力（佛耶戈继承比例用） */
  baseAtk: number;
  hp: number;
  maxHp: number;
  shield: number;
  mana: number;
  maxMana: number;
  startMana: number;
  statuses: StatusInstance[];
  attackCount: number;
  castCount: number;
  alive: boolean;
  /** 已装备的武器（只用于展示与快照，数值已并入 atk/hp） */
  equips: { configId: string; level: 1 | 2; atk: number; hp: number }[];
  skill: ActiveSkillConfig | null;
  passives: PassiveConfig[];
  /** 羁绊派生字段（开战时写入） */
  targetRule: EnemyTargetRule | null;
  skillAmp: number;
  firstSkillAmp: number;
  healShieldAmp: number;
  copyBuffToExtraAlly: boolean;
  lowHpThreshold: number;
  lowHpDamageReduction: number;
  extraAttackEvery: number;
  extraAttackRatio: number;
  shieldBreakAtkBuff: number;
  shieldBroken: boolean;
  onKillAtkBuff: number;
  onKillHealRatio: number;
  castManaRefund: number;
  firstCastManaRefund: number;
  soulStacks: number;
  maxSoulStacks: number;
  soulAtkBuff: number;
  passiveUses: Record<string, number>;
  revived: boolean;
}

export interface BattleContext {
  state: GameState;
  rng: Rng;
  aId: number;
  bId: number;
  events: BattleEvent[];
  units: BattleUnit[];
  byUid: Map<number, BattleUnit>;
  pendingDeaths: { unit: BattleUnit; killer: BattleUnit | null }[];
  pendingShieldBreaks: BattleUnit[];
  /** `${owner}:${traitId}` → 档位 */
  traitTiers: Map<string, number>;
  deathsByOwner: Map<number, number>;
  steps: number;
}

/** 本场战斗的派生 RNG 种子：seed + 回合 + 双方玩家 ID */
export function battleSeed(state: GameState, aId: number, bId: number): number {
  return (
    (state.seed ^ Math.imul(state.round, 0x9e3779b9) ^ Math.imul(aId + 1, 0x85ebca6b) ^ Math.imul(bId + 1, 0xc2b2ae35)) >>>
    0
  );
}

function makeUnit(card: CardInstance, owner: number): BattleUnit {
  const cfg = CARD_BY_ID.get(card.configId);
  const maxMana = cfg?.maxMana ?? 0;
  // 装备加成在这里并入战斗面板数值（card.atk/hp 只存英雄自身数值）
  const atk = totalAtk(card);
  const hp = totalHp(card);
  // 武器被动并入英雄被动（先英雄后武器，索引稳定）
  const passives = [
    ...(cfg?.passives ?? []),
    ...card.equips.flatMap((e) => CARD_BY_ID.get(e.configId)?.passives ?? []),
  ];
  return {
    uid: card.uid,
    owner,
    configId: card.configId,
    level: card.level,
    position: card.position ?? 0,
    atk,
    baseAtk: atk,
    hp,
    maxHp: hp,
    shield: 0,
    mana: Math.min(cfg?.startMana ?? 0, maxMana),
    maxMana,
    startMana: cfg?.startMana ?? 0,
    statuses: [],
    attackCount: 0,
    castCount: 0,
    alive: hp > 0,
    equips: card.equips.map((e) => ({ configId: e.configId, level: e.level, atk: e.atk, hp: e.hp })),
    skill: cfg?.skill ?? null,
    passives,
    targetRule: null,
    skillAmp: 0,
    firstSkillAmp: 0,
    healShieldAmp: 0,
    copyBuffToExtraAlly: false,
    lowHpThreshold: 0,
    lowHpDamageReduction: 0,
    extraAttackEvery: 0,
    extraAttackRatio: 0,
    shieldBreakAtkBuff: 0,
    shieldBroken: false,
    onKillAtkBuff: 0,
    onKillHealRatio: 0,
    castManaRefund: 0,
    firstCastManaRefund: 0,
    soulStacks: 0,
    maxSoulStacks: 0,
    soulAtkBuff: 0,
    passiveUses: {},
    revived: false,
  };
}

function toSnapshot(u: BattleUnit): BattleUnitSnapshot {
  return {
    uid: u.uid,
    owner: u.owner,
    configId: u.configId,
    level: u.level,
    atk: u.atk,
    hp: u.hp,
    maxHp: u.maxHp,
    position: u.position,
    mana: u.mana,
    maxMana: u.maxMana,
    startMana: u.startMana,
    shield: u.shield,
    statuses: u.statuses.map((s) => ({ ...s })),
    attackCount: u.attackCount,
    castCount: u.castCount,
    equips: u.equips.map((e) => ({ ...e })),
  };
}

function hasAlive(ctx: BattleContext, owner: number): boolean {
  return ctx.units.some((u) => u.owner === owner && u.alive);
}

function unitAt(ctx: BattleContext, owner: number, pos: number): BattleUnit | null {
  return ctx.units.find((u) => u.owner === owner && u.position === pos) ?? null;
}

function survivorsOf(ctx: BattleContext, owner: number) {
  return ctx.units
    .filter((u) => u.owner === owner && u.alive)
    .map((u) => ({ player: owner, cardUid: u.uid, hp: u.hp }));
}

function remainingHpSum(ctx: BattleContext, owner: number): number {
  return ctx.units.reduce((s, u) => (u.owner === owner && u.alive ? s + u.hp : s), 0);
}

/* ══════════════ 行动前状态处理 ══════════════ */

/** @returns true = 可以行动；false = 被眩晕/魅惑跳过 */
function beginAction(ctx: BattleContext, unit: BattleUnit): boolean {
  for (const st of [...unit.statuses]) {
    if (st.id !== "damage_reduction") continue;
    st.duration -= 1;
    if (st.duration <= 0) removeStatus(ctx, unit, st);
  }
  const cc = unit.statuses.find((s) => s.id === "stun" || s.id === "charm");
  if (cc) {
    cc.duration -= 1;
    if (cc.duration <= 0) removeStatus(ctx, unit, cc);
    return false;
  }
  return true;
}

/* ══════════════ 死亡 / 破盾结算（触发击杀、阵亡、羁绊） ══════════════ */

function drainDeaths(ctx: BattleContext): void {
  while (ctx.pendingDeaths.length > 0) {
    const { unit, killer } = ctx.pendingDeaths.shift()!;
    if (killer && killer.alive) {
      triggerPassives(ctx, killer, "on_kill", unit);
      handleKill(ctx, killer, unit);
    }
    handleAllyDeath(ctx, unit);
  }
}

function drainShieldBreaks(ctx: BattleContext): void {
  while (ctx.pendingShieldBreaks.length > 0) {
    handleShieldBreak(ctx, ctx.pendingShieldBreaks.shift()!);
  }
}

/* ══════════════ 普攻 ══════════════ */

function basicAttack(ctx: BattleContext, unit: BattleUnit, target: BattleUnit): void {
  if (!target.alive) return;
  ctx.events.push({ type: "ATTACK", from: unit.uid, to: target.uid, dmg: unit.atk });
  dealDamage(ctx, unit, target, unit.atk);
  unit.attackCount += 1;
  gainMana(ctx, unit, balanceConfig.manaPerAttack, "attack");

  // 射手羁绊：每第 N 次普攻追加一次攻击
  if (unit.extraAttackEvery > 0 && unit.attackCount % unit.extraAttackEvery === 0) {
    const second = target.alive ? target : basicAttackTarget(ctx, unit);
    if (second) {
      const extra = ratioOf(unit.atk, unit.extraAttackRatio);
      ctx.events.push({ type: "ATTACK", from: unit.uid, to: second.uid, dmg: extra });
      dealDamage(ctx, unit, second, extra);
    }
  }
}

/* ══════════════ 技能 ══════════════ */

interface StepOutcome {
  /** 本步骤实际造成的生命伤害（斯维因治疗比例用） */
  hpDamage: number;
  /** 命中目标数（赫卡里姆护盾用） */
  hitCount: number;
  killed: boolean;
}

function resolveStepTargets(
  ctx: BattleContext,
  unit: BattleUnit,
  step: SkillStep,
  primary: BattleUnit,
  previous: BattleUnit[],
): BattleUnit[] {
  if (step.target === "same_as_previous") return previous.filter((t) => t.alive);
  return selectTargets(ctx, step.target, unit, primary, pickStar(step.maxTargets, unit.level, 1));
}

function applyStep(
  ctx: BattleContext,
  unit: BattleUnit,
  step: SkillStep,
  primary: BattleUnit,
  previous: BattleUnit[],
  damageSoFar: number,
  firstCastAmp: number,
): StepOutcome & { targets: BattleUnit[] } {
  const targets = resolveStepTargets(ctx, unit, step, primary, previous);
  const out: StepOutcome = { hpDamage: 0, hitCount: 0, killed: false };
  if (targets.length === 0) return { ...out, targets };

  const damageAmp = unit.skillAmp + firstCastAmp;
  const supportAmp = unit.skillAmp + unit.healShieldAmp;
  const hits = pickStar(step.hits, unit.level, 1);

  switch (step.effect) {
    case "damage": {
      const base = pickStar(step.value, unit.level) + Math.floor(unit.atk * pickStar(step.atkScale, unit.level, 0));
      const amount = amplify(base, damageAmp);
      if (step.retargetEachHit) {
        for (let h = 0; h < hits; h++) {
          const picked = selectTargets(ctx, step.target, unit, primary, 1);
          const t = picked[0];
          if (!t) break;
          const r = dealDamage(ctx, unit, t, amount);
          out.hpDamage += r.hpDamage;
          out.hitCount += 1;
          if (r.killed) out.killed = true;
        }
        break;
      }
      for (const t of targets) {
        if (!t.alive) continue;
        if (step.threshold) {
          const th = pickStar(step.threshold, unit.level, 0);
          if (t.maxHp > 0 && t.hp / t.maxHp <= th) {
            const r = dealDamage(ctx, unit, t, t.hp);
            out.hpDamage += r.hpDamage;
            out.hitCount += 1;
            if (r.killed) out.killed = true;
            continue;
          }
        }
        for (let h = 0; h < hits; h++) {
          if (!t.alive) break; // 目标中途死亡 → 停止剩余段数
          const r = dealDamage(ctx, unit, t, amount);
          out.hpDamage += r.hpDamage;
          if (r.killed) out.killed = true;
        }
        out.hitCount += 1;
      }
      break;
    }
    case "execute": {
      for (const t of targets) {
        if (!t.alive) continue;
        const th = pickStar(step.threshold, unit.level, 1);
        if (t.maxHp > 0 && t.hp / t.maxHp <= th) {
          const r = dealDamage(ctx, unit, t, t.hp);
          out.hpDamage += r.hpDamage;
          out.hitCount += 1;
          if (r.killed) out.killed = true;
        }
      }
      break;
    }
    case "heal": {
      const amount = step.healRatioOfDamage
        ? ratioOf(damageSoFar, pickStar(step.healRatioOfDamage, unit.level, 0))
        : amplify(pickStar(step.value, unit.level), supportAmp);
      for (const t of targets) if (t.alive) applyHeal(ctx, unit, t, amount);
      out.hitCount = targets.length;
      break;
    }
    case "shield": {
      const amount = step.shieldPerHit
        ? amplify(pickStar(step.shieldPerHit, unit.level) * previous.length, supportAmp)
        : amplify(pickStar(step.value, unit.level), supportAmp);
      for (const t of targets) if (t.alive) applyShield(ctx, unit, t, amount);
      out.hitCount = targets.length;
      // 辅助 4 人档：单体友方增益复制给另一名残血友军
      if (unit.copyBuffToExtraAlly && step.target === "lowest_hp_ally" && amount > 0) {
        const others = selectTargets(ctx, "lowest_hp_ally", unit, primary, 3).filter(
          (t) => t.alive && !targets.includes(t),
        );
        const extra = others[0];
        if (extra) applyShield(ctx, unit, extra, amount);
      }
      break;
    }
    case "stun": {
      const duration = pickStar(step.duration, unit.level, 1);
      for (const t of targets) applyStatus(ctx, unit, t, "stun", duration);
      out.hitCount = targets.length;
      break;
    }
    case "charm": {
      const duration = pickStar(step.duration, unit.level, 1);
      for (const t of targets) applyStatus(ctx, unit, t, "charm", duration);
      out.hitCount = targets.length;
      break;
    }
    case "damage_reduction": {
      const duration = pickStar(step.duration, unit.level, 1);
      const ratio = pickStar(step.ratio, unit.level, 0);
      for (const t of targets) applyStatus(ctx, unit, t, "damage_reduction", duration, ratio);
      out.hitCount = targets.length;
      break;
    }
    case "attack_buff": {
      const amount = pickStar(step.value, unit.level);
      for (const t of targets) applyAttackBuff(ctx, t, amount);
      out.hitCount = targets.length;
      break;
    }
    case "mana_gain": {
      const amount = pickStar(step.value, unit.level);
      for (const t of targets) gainMana(ctx, t, amount, "skill");
      out.hitCount = targets.length;
      break;
    }
    case "break_shield": {
      for (const t of targets) breakShield(ctx, unit, t);
      out.hitCount = targets.length;
      break;
    }
  }
  return { ...out, targets };
}

function castSkill(ctx: BattleContext, unit: BattleUnit, skill: ActiveSkillConfig, primary: BattleUnit): void {
  ctx.events.push({
    type: "SKILL_CAST",
    caster: unit.uid,
    skillId: skill.id,
    skillName: skill.name,
    targets: [primary.uid],
  });
  unit.castCount += 1;
  const firstCastAmp = unit.castCount === 1 ? unit.firstSkillAmp : 0;
  spendMana(ctx, unit, unit.maxMana, "cast");

  let previous: BattleUnit[] = [];
  let damageSoFar = 0;
  let killedAny = false;
  let repeatOnKill = false;

  for (const step of skill.steps) {
    const result = applyStep(ctx, unit, step, primary, previous, damageSoFar, firstCastAmp);
    damageSoFar += result.hpDamage;
    if (result.killed) killedAny = true;
    if (step.repeatOnKill) repeatOnKill = true;
    if (result.targets.length > 0) previous = result.targets;
  }

  handleSkillCast(ctx, unit);
  triggerPassives(ctx, unit, "on_skill_cast");
  drainDeaths(ctx);
  drainShieldBreaks(ctx);

  // 德莱厄斯：击杀后立即追加一次普攻（每次施法最多一次）
  if (repeatOnKill && killedAny && unit.alive) {
    const next = basicAttackTarget(ctx, unit);
    if (next) basicAttack(ctx, unit, next);
  }
}

/* ══════════════ 单位行动 ══════════════ */

function actUnit(ctx: BattleContext, unit: BattleUnit | null): void {
  if (!unit || !unit.alive) return;
  const target = basicAttackTarget(ctx, unit);
  if (!target) return;
  if (!beginAction(ctx, unit)) return; // 眩晕/魅惑跳过（目标已锁定但不出手）

  if (unit.skill && unit.maxMana > 0 && unit.mana >= unit.maxMana) {
    castSkill(ctx, unit, unit.skill, target);
  } else {
    basicAttack(ctx, unit, target);
  }
  ctx.steps += 1;
  drainDeaths(ctx);
  drainShieldBreaks(ctx);
}

/* ══════════════ 主入口 ══════════════ */

export function createBattleContext(state: GameState, aId: number, bId: number): BattleContext {
  const pa = state.players[aId]!;
  const pb = state.players[bId]!;
  // 快照副本：战斗中的血量变化不影响真实场上卡牌（每场战斗满血开打）
  const boardA = pa.board.filter((c): c is CardInstance => c !== null).map((c) => ({ ...c }));
  const boardB = pb.board.filter((c): c is CardInstance => c !== null).map((c) => ({ ...c }));

  const ctx: BattleContext = {
    state,
    rng: createRng(battleSeed(state, aId, bId)),
    aId,
    bId,
    events: [],
    units: [...boardA.map((c) => makeUnit(c, aId)), ...boardB.map((c) => makeUnit(c, bId))],
    byUid: new Map(),
    pendingDeaths: [],
    pendingShieldBreaks: [],
    traitTiers: new Map(),
    deathsByOwner: new Map(),
    steps: 0,
  };
  for (const u of ctx.units) ctx.byUid.set(u.uid, u);
  return ctx;
}

/** 开战地图加成（双方全体英雄，效果来自 config/maps.ts） */
export function applyMapEffect(ctx: BattleContext, owner: number): void {
  const mapId = ctx.state.mapId;
  if (!mapId) return;
  const map = MAP_BY_ID.get(mapId);
  if (!map) return;
  const units = ctx.units.filter((u) => u.owner === owner && u.alive);
  if (units.length === 0) return;
  const targets: number[] = [];
  for (const u of units) {
    const e = map.effect;
    if (e.maxHp) {
      u.maxHp += e.maxHp;
      u.hp += e.maxHp;
    }
    if (e.atk) u.atk += e.atk;
    if (e.startMana) gainMana(ctx, u, e.startMana, "map");
    if (e.shield) applyShield(ctx, u, u, e.shield);
    targets.push(u.uid);
  }
  ctx.events.push({ type: "MAP_EFFECT", mapId, owner, targets });
}

/** 运行一场已经建好的战斗（开战羁绊 → 行动循环 → BATTLE_END） */
export function runBattle(ctx: BattleContext): BattleEvent[] {
  return runBattleBetween(ctx, ctx.aId, ctx.bId);
}

function runBattleBetween(ctx: BattleContext, aId: number, bId: number): BattleEvent[] {
  // 调用方在建好上下文后、开战前产生的事件（例如测试预置的眩晕）需保留，排在 BATTLE_START 之后
  const preBuffer: BattleEvent[] = ctx.events.slice();
  // 开战羁绊/地图/被动先结算，但事件排在 BATTLE_START 之后（UI 以 events[0] 为战斗面板数据源）
  const traitBuffer: BattleEvent[] = [];
  ctx.events = traitBuffer;
  applyBattleStartTraits(ctx, aId);
  applyBattleStartTraits(ctx, bId);
  applyMapEffect(ctx, aId);
  applyMapEffect(ctx, bId);
  // on_battle_start 被动（装备被动大多在这里生效）：按位置顺序结算，保证确定性
  for (const unit of [...ctx.units].sort((x, y) => x.owner - y.owner || x.position - y.position)) {
    if (unit.alive) triggerPassives(ctx, unit, "on_battle_start");
  }
  ctx.events = [];

  const events = ctx.events;
  events.push({
    type: "BATTLE_START",
    a: aId,
    b: bId,
    boards: {
      a: ctx.units.filter((u) => u.owner === aId).map(toSnapshot),
      b: ctx.units.filter((u) => u.owner === bId).map(toSnapshot),
    },
  });
  events.push(...traitBuffer);
  events.push(...preBuffer);
  drainShieldBreaks(ctx);

  const endEvent = (winner: number | null): BattleEvent => ({
    type: "BATTLE_END",
    winner,
    survivors:
      winner === null
        ? [...survivorsOf(ctx, aId), ...survivorsOf(ctx, bId)]
        : survivorsOf(ctx, winner),
  });

  let pos = 1;
  let iterations = 0;
  const iterationCap = gameConfig.maxBattleSteps * 6;

  for (;;) {
    const aAlive = hasAlive(ctx, aId);
    const bAlive = hasAlive(ctx, bId);
    if (!aAlive && !bAlive) {
      events.push(endEvent(null)); // 平局
      return events;
    }
    if (!aAlive) {
      events.push(endEvent(bId));
      return events;
    }
    if (!bAlive) {
      events.push(endEvent(aId));
      return events;
    }

    actUnit(ctx, unitAt(ctx, aId, pos));
    actUnit(ctx, unitAt(ctx, bId, pos));

    pos = (pos % 6) + 1;
    iterations += 1;

    // 防死循环保护：超步数按剩余血量总和判定
    if (ctx.steps >= gameConfig.maxBattleSteps || iterations >= iterationCap) {
      const sumA = remainingHpSum(ctx, aId);
      const sumB = remainingHpSum(ctx, bId);
      if (sumA === sumB) events.push(endEvent(null));
      else if (sumA > sumB) events.push(endEvent(aId));
      else events.push(endEvent(bId));
      return events;
    }
  }
}

/* ══════════════ 主入口 ══════════════ */

export function simulateBattle(state: GameState, aId: number, bId: number): BattleEvent[] {
  return runBattleBetween(createBattleContext(state, aId, bId), aId, bId);
}

/** 从事件日志中提取战斗开局快照（测试/UI 用） */
export function initialSnapshot(events: BattleEvent[]): { a: BattleUnitSnapshot[]; b: BattleUnitSnapshot[] } | null {
  const first = events[0];
  if (!first || first.type !== "BATTLE_START") return null;
  return first.boards;
}

/** 计算某方战斗开始时的激活羁绊（UI 羁绊面板用，不修改任何状态） */
export function activeTraitsOfBoard(state: GameState, owner: number): ActiveTrait[] {
  const p = state.players[owner];
  if (!p) return [];
  const units = p.board
    .filter((c): c is CardInstance => c !== null && totalHp(c) > 0)
    .map((c) => makeUnit({ ...c }, owner));
  return activeTraitsFor(units);
}
