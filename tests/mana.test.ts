import { describe, expect, it } from "vitest";
import { makeCtx, place, battleCtx, eventsOfType, fillMana } from "./helpers";
import { runBattle } from "../core/battle";
import { gainMana } from "../core/effects";
import { balanceConfig } from "../config/balance";

/**
 * 法力与施法（T1）
 * 规则：普攻后 +10；受到至少 1 点实际生命伤害后 +5（护盾全吸收不给）；
 *      满法力时行动开始优先施法；施法扣除 maxMana（溢出安全）；无技能卡永远不施法。
 */

function setup() {
  const { state, p } = makeCtx(90210);
  return { state, p, enemy: state.players[1]! };
}

describe("法力积攒", () => {
  it("普攻后 +10 法力，受伤 +5 法力（MANA_CHANGE 事件可追溯）", () => {
    const { state, p, enemy } = setup();
    const me = place(state, p, "garen", 1); // 0/60
    place(state, enemy, "garen", 1);
    const ctx = battleCtx(state);
    const events = runBattle(ctx);
    const mana = eventsOfType(events, "MANA_CHANGE");

    const attackGain = mana.find((e) => e.who === me.uid && e.reason === "attack");
    expect(attackGain).toBeDefined();
    expect(attackGain!.after - attackGain!.before).toBe(balanceConfig.manaPerAttack);
    expect(attackGain!.before).toBe(0);

    const hurtGain = mana.find((e) => e.who === me.uid && e.reason === "hurt");
    expect(hurtGain).toBeDefined();
    expect(hurtGain!.after - hurtGain!.before).toBe(balanceConfig.manaPerDamageTaken);
  });

  it("法力不会超过 maxMana", () => {
    const { state, p, enemy } = setup();
    const me = place(state, p, "garen", 1);
    place(state, enemy, "garen", 1);
    const ctx = battleCtx(state);
    const unit = ctx.byUid.get(me.uid)!;
    unit.mana = unit.maxMana - 3;
    gainMana(ctx, unit, 10, "test");
    expect(unit.mana).toBe(unit.maxMana);
  });

  it("没有技能/法力配置的卡（旧卡）永远不产生法力事件", () => {
    const { state, p, enemy } = setup();
    place(state, p, "lan", 1);
    place(state, enemy, "lan", 1);
    const ctx = battleCtx(state);
    const events = runBattle(ctx);
    expect(eventsOfType(events, "MANA_CHANGE")).toHaveLength(0);
    expect(eventsOfType(events, "SKILL_CAST")).toHaveLength(0);
  });

  it("被护盾完全吸收的伤害不给受击法力", () => {
    const { state, p, enemy } = setup();
    place(state, p, "garen", 1);
    const foe = place(state, enemy, "garen", 1);
    const ctx = battleCtx(state);
    const target = ctx.byUid.get(foe.uid)!;
    target.shield = 50;
    const events = runBattle(ctx);
    const hurt = eventsOfType(events, "MANA_CHANGE").filter(
      (e) => e.who === foe.uid && e.reason === "hurt",
    );
    expect(hurt).toHaveLength(0);
  });
});

describe("施法", () => {
  it("满法力时该单位第一次行动即施法（不是普攻）", () => {
    const { state, p, enemy } = setup();
    const me = place(state, p, "lux", 1); // 30/80
    const foe = place(state, enemy, "lan", 1); // 旧卡 2 攻，加厚血量让战斗持续
    foe.hp = 100;
    const ctx = battleCtx(state);
    fillMana(ctx, me.uid);
    const events = runBattle(ctx);
    const firstCast = events.findIndex((e) => e.type === "SKILL_CAST" && e.caster === me.uid);
    const firstAttack = events.findIndex((e) => e.type === "ATTACK" && e.from === me.uid);
    expect(firstCast).toBeGreaterThan(-1);
    expect(firstAttack).toBeGreaterThan(-1);
    expect(firstCast).toBeLessThan(firstAttack);
  });

  it("施法后扣除 maxMana 而不是无条件归零（溢出法力安全保留）", () => {
    const { state, p, enemy } = setup();
    const me = place(state, p, "garen", 1); // maxMana 60
    place(state, enemy, "taitan", 1);
    const ctx = battleCtx(state);
    const unit = ctx.byUid.get(me.uid)!;
    unit.mana = unit.maxMana + 15; // 模拟溢出
    const events = runBattle(ctx);
    const cast = eventsOfType(events, "MANA_CHANGE").find(
      (e) => e.who === me.uid && e.reason === "cast",
    );
    expect(cast).toBeDefined();
    expect(cast!.before).toBe(75);
    expect(cast!.after).toBe(15);
  });

  it("SKILL_CAST 事件带技能名与施法者", () => {
    const { state, p, enemy } = setup();
    const me = place(state, p, "ahri", 1);
    place(state, enemy, "taitan", 1);
    const ctx = battleCtx(state);
    fillMana(ctx, me.uid);
    const events = runBattle(ctx);
    const cast = eventsOfType(events, "SKILL_CAST")[0]!;
    expect(cast.caster).toBe(me.uid);
    expect(cast.skillName).toBe("欺诈宝珠");
    expect(cast.skillId).toBe("ahri_charm");
    expect(cast.targets.length).toBeGreaterThan(0);
  });

  it("法力不足时不施法，继续普攻", () => {
    const { state, p, enemy } = setup();
    const me = place(state, p, "ahri", 1); // startMana 30 / 80
    place(state, enemy, "garen", 1);
    const ctx = battleCtx(state);
    const events = runBattle(ctx);
    const firstAttack = events.findIndex((e) => e.type === "ATTACK" && e.from === me.uid);
    const firstCast = events.findIndex((e) => e.type === "SKILL_CAST" && e.caster === me.uid);
    expect(firstAttack).toBeGreaterThan(-1);
    // 第一次行动是普攻（30 < 80）；如果之后施法，一定在普攻之后
    if (firstCast > -1) expect(firstCast).toBeGreaterThan(firstAttack);
  });
});
