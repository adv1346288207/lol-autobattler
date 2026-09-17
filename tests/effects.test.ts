import { describe, expect, it } from "vitest";
import { makeCtx, place, battleCtx, eventsOfType, fillMana } from "./helpers";
import { runBattle, type BattleContext, type BattleUnit } from "../core/battle";
import { applyHeal, applyStatus, breakShield, dealDamage } from "../core/effects";
import type { StatusId } from "../core/state";

/**
 * 通用战斗效果（T1）：伤害 / 护盾吸收 / 破盾 / 治疗上限 / 控制 / 多段攻击 / 斩杀 / 减伤
 */

function setup() {
  const { state, p } = makeCtx(31337);
  return { state, p, enemy: state.players[1]! };
}

/** 建好战斗上下文并取出一对攻守单位 */
function pair(state: ReturnType<typeof makeCtx>["state"], meId: string, foeId: string) {
  const me = place(state, state.players[0]!, meId, 1);
  const foe = place(state, state.players[1]!, foeId, 1);
  const ctx = battleCtx(state);
  return { ctx, a: ctx.byUid.get(me.uid)!, t: ctx.byUid.get(foe.uid)!, me, foe };
}

function statusOn(
  ctx: BattleContext,
  a: BattleUnit,
  t: BattleUnit,
  id: StatusId,
  duration: number,
  value = 0,
) {
  applyStatus(ctx, a, t, id, duration, value);
}

describe("伤害与护盾", () => {
  it("伤害先扣护盾再扣生命，事件分别记录 amount/absorbed/remainingHp", () => {
    const { state } = setup();
    const { ctx, a, t } = pair(state, "garen", "garen");
    t.shield = 5;
    const result = dealDamage(ctx, a, t, 3);
    expect(result.absorbed).toBe(3);
    expect(result.hpDamage).toBe(0);
    expect(t.hp).toBe(t.maxHp);
    expect(t.shield).toBe(2);

    const dmg = eventsOfType(ctx.events, "DAMAGE")[0]!;
    expect(dmg.absorbed).toBe(3);
    expect(dmg.amount).toBe(3);
    expect(dmg.remainingHp).toBe(t.maxHp);
    expect(eventsOfType(ctx.events, "SHIELD_BREAK")).toHaveLength(0);
  });

  it("护盾被打空时产生 SHIELD_BREAK 事件", () => {
    const { state } = setup();
    const { ctx, a, t } = pair(state, "garen", "garen");
    t.shield = 2;
    dealDamage(ctx, a, t, 5);
    expect(t.shield).toBe(0);
    expect(t.hp).toBe(t.maxHp - 3);
    const breaks = eventsOfType(ctx.events, "SHIELD_BREAK");
    expect(breaks).toHaveLength(1);
    expect(breaks[0]!.amount).toBe(2);
  });

  it("护盾完全吸收伤害时不给受击法力", () => {
    const { state } = setup();
    const { ctx, a, t } = pair(state, "garen", "garen");
    t.shield = 10;
    const before = t.mana;
    dealDamage(ctx, a, t, 5);
    expect(t.mana).toBe(before);
  });

  it("破盾效果清除目标全部护盾", () => {
    const { state } = setup();
    const { ctx, a, t } = pair(state, "vi", "garen");
    t.shield = 7;
    breakShield(ctx, a, t);
    expect(t.shield).toBe(0);
    expect(eventsOfType(ctx.events, "SHIELD_BREAK")[0]!.amount).toBe(7);
  });
});

describe("治疗 / 减伤 / 控制", () => {
  it("治疗不超过最大生命", () => {
    const { state } = setup();
    const { ctx, a, t } = pair(state, "garen", "garen");
    t.hp = 2;
    const healed = applyHeal(ctx, a, t, 100);
    expect(healed).toBe(t.maxHp - 2);
    expect(t.hp).toBe(t.maxHp);
    expect(eventsOfType(ctx.events, "HEAL")[0]!.amount).toBe(t.maxHp - 2);
  });

  it("减伤状态按比例降低伤害（向下取整）", () => {
    const { state } = setup();
    const { ctx, a, t } = pair(state, "garen", "garen");
    statusOn(ctx, a, t, "damage_reduction", 1, 0.4);
    const r = dealDamage(ctx, a, t, 10);
    expect(r.hpDamage).toBe(6); // 10 × (1-0.4)
  });

  it("眩晕 1 次行动：目标跳过自己的下一次行动并产生状态事件", () => {
    const { state, p, enemy } = setup();
    const me = place(state, p, "garen", 1); // 2 攻 / 7 血
    const foe = place(state, enemy, "garen", 1);
    const ctx = battleCtx(state);
    const mine = ctx.byUid.get(me.uid)!;
    const theirs = ctx.byUid.get(foe.uid)!;
    statusOn(ctx, mine, theirs, "stun", 1);
    const events = runBattle(ctx);

    const firstFoeAttackIdx = events.findIndex((e) => e.type === "ATTACK" && e.from === foe.uid);
    expect(firstFoeAttackIdx).toBeGreaterThan(0);
    // 我方先手，敌方第一次行动被跳过：敌方首次攻击前我方已攻击 2 次（2×2=4，敌方 7 血仍存活）
    const myAttacksBefore = events
      .slice(0, firstFoeAttackIdx)
      .filter((e) => e.type === "ATTACK" && e.from === me.uid).length;
    expect(myAttacksBefore).toBe(2);

    expect(
      eventsOfType(events, "STATUS_APPLY").some((e) => e.status === "stun" && e.target === foe.uid),
    ).toBe(true);
    expect(
      eventsOfType(events, "STATUS_REMOVE").some((e) => e.status === "stun" && e.target === foe.uid),
    ).toBe(true);
  });
});

/** 取某单位"下一次普攻之前"的连续技能伤害段（跳过 MANA_CHANGE 等伴随事件） */
function skillHitAmounts(events: ReturnType<typeof runBattle>, caster: number, target: number): number[] {
  const skillIdx = events.findIndex((e) => e.type === "SKILL_CAST" && e.caster === caster);
  if (skillIdx < 0) return [];
  const hits: number[] = [];
  for (let i = skillIdx + 1; i < events.length; i++) {
    const e = events[i]!;
    if (e.type === "ATTACK" || e.type === "SKILL_CAST") break;
    if (e.type === "DAMAGE" && e.source === caster && e.target === target) hits.push(e.amount);
  }
  return hits;
}

describe("多段攻击", () => {
  it("卡莉丝塔对当前目标打满 4 段（一星，每段 50% 攻击力）", () => {
    const { state, p, enemy } = setup();
    const me = place(state, p, "kalista", 1);
    const foe = place(state, enemy, "taitan", 1); // 6/12，能扛住 4 段
    const ctx = battleCtx(state);
    fillMana(ctx, me.uid);
    const events = runBattle(ctx);
    const hits = skillHitAmounts(events, me.uid, foe.uid);
    expect(hits).toHaveLength(4);
    expect(hits.every((amt) => amt === Math.max(1, Math.floor(4 * 0.5)))).toBe(true);
  });

  it("目标中途死亡则停止剩余段数", () => {
    const { state, p, enemy } = setup();
    const me = place(state, p, "kalista", 1); // 每段 50% × 4 攻 = 2 点
    const foe = place(state, enemy, "lan", 1);
    foe.hp = 3; // 3 血：第 1 段剩 1 血，第 2 段死亡 → 第 3、4 段不再结算
    const ctx = battleCtx(state);
    fillMana(ctx, me.uid);
    const events = runBattle(ctx);
    const hits = skillHitAmounts(events, me.uid, foe.uid);
    expect(hits).toHaveLength(2);
    expect(eventsOfType(events, "DEATH").some((e) => e.who === foe.uid)).toBe(true);
  });

  it("德莱文二星飞斧为 3 段 100% 攻击力", () => {
    const { state, p, enemy } = setup();
    const me = place(state, p, "draven", 1);
    me.level = 2;
    me.atk = 12; // 三张之和
    me.hp = 15;
    const foe = place(state, enemy, "taitan", 1);
    foe.hp = 60; // 加厚血量，确保单次施法的 3 段都能打满
    const ctx = battleCtx(state);
    fillMana(ctx, me.uid);
    const events = runBattle(ctx);
    const hits = skillHitAmounts(events, me.uid, foe.uid);
    expect(hits).toHaveLength(3);
    expect(hits[0]).toBe(Math.floor(12 * 1.0));
  });
});

describe("斩杀与击杀连击", () => {
  it("德莱厄斯：目标生命低于 25% 时直接斩杀，并在击杀后追加一次普攻", () => {
    const { state, p, enemy } = setup();
    const me = place(state, p, "darius", 1);
    const tank = place(state, enemy, "taitan", 1); // 12 血 → 2/12 低于 25%
    tank.hp = 2;
    const other = place(state, enemy, "poppy", 3);
    const ctx = battleCtx(state);
    ctx.byUid.get(tank.uid)!.maxHp = 12; // 保持最大生命 12，当前生命 2（低于斩杀线）
    fillMana(ctx, me.uid);
    const events = runBattle(ctx);

    const death = eventsOfType(events, "DEATH").find((e) => e.who === tank.uid);
    expect(death).toBeDefined();
    expect(death!.killer).toBe(me.uid);
    // 斩杀伤害 = 目标当前生命，而不是技能基础值
    const executeHit = eventsOfType(events, "DAMAGE").find(
      (e) => e.target === tank.uid && e.source === me.uid,
    )!;
    expect(executeHit.amount).toBe(2);
    // 击杀后追加一次普攻（目标切换为剩余的敌人）
    const extra = eventsOfType(events, "ATTACK").filter((e) => e.from === me.uid && e.to === other.uid);
    expect(extra.length).toBeGreaterThan(0);
  });

  it("死亡只触发一次：同一单位只有一条 DEATH 事件", () => {
    const { state, p, enemy } = setup();
    place(state, p, "viego", 1);
    const foe = place(state, enemy, "lan", 1);
    const ctx = battleCtx(state);
    const events = runBattle(ctx);
    expect(eventsOfType(events, "DEATH").filter((e) => e.who === foe.uid)).toHaveLength(1);
  });
});
