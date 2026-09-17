import { describe, expect, it } from "vitest";
import { makeCtx, place, battleCtx, eventsOfType, fillMana } from "./helpers";
import { runBattle } from "../core/battle";
import { activeTraitsFor, applyBattleStartTraits, traitCountsFor, handleShieldBreak } from "../core/traits";
import { CARD_BY_ID } from "../config/cards";
import { dealDamage } from "../core/effects";
import type { GameState, PlayerState } from "../core/state";

/**
 * 羁绊（T1）：2/4 阈值、同名去重、复制器排除，以及 5 地区 + 6 职业的核心效果。
 * 数值全部来自 config/traits.ts。
 */
function setup(seed = 4242) {
  const { state, p } = makeCtx(seed);
  return { state, p, enemy: state.players[1]! };
}

/** 在某一方棋盘上按顺序放一批英雄 */
function lineup(state: GameState, owner: PlayerState, ids: string[], startPos = 1): number[] {
  return ids.map((id, i) => place(state, owner, id, startPos + i).uid);
}

/** 建 ctx 并结算开战羁绊，返回上下文与指定 uid 的单位 */
function withTraits(state: GameState, aIds: string[], bIds: string[] = ["lan"]) {
  const uids = lineup(state, state.players[0]!, aIds);
  lineup(state, state.players[1]!, bIds);
  const ctx = battleCtx(state);
  applyBattleStartTraits(ctx, 0);
  applyBattleStartTraits(ctx, 1);
  return { ctx, uids, unit: (i: number) => ctx.byUid.get(uids[i]!)! };
}

describe("羁绊统计与阈值", () => {
  it("1 人未激活、2 人激活 2 档、4 人激活 4 档", () => {
    const { state } = setup();
    const { ctx } = withTraits(state, ["garen"]);
    expect(activeTraitsFor(ctx.units.filter((u) => u.owner === 0)).some((t) => t.id === "demacia")).toBe(false);

    const s2 = setup().state;
    const r2 = withTraits(s2, ["garen", "poppy"]);
    const demacia2 = activeTraitsFor(r2.ctx.units.filter((u) => u.owner === 0)).find((t) => t.id === "demacia");
    expect(demacia2).toMatchObject({ count: 2, tier: 0 });

    const s4 = setup().state;
    const r4 = withTraits(s4, ["garen", "poppy", "lux", "jarvan_iv"]);
    const demacia4 = activeTraitsFor(r4.ctx.units.filter((u) => u.owner === 0)).find((t) => t.id === "demacia");
    expect(demacia4).toMatchObject({ count: 4, tier: 1 });
  });

  it("同名英雄只计 1 次（3 个盖伦 + 1 个波比 = 德玛西亚 2 人）", () => {
    const { state } = setup();
    const { ctx } = withTraits(state, ["garen", "garen", "garen", "poppy"]);
    const counts = traitCountsFor(ctx.units.filter((u) => u.owner === 0));
    expect(counts.get("demacia")).toBe(2);
    expect(counts.get("vanguard")).toBe(2); // 盖伦 + 波比
  });

  it("英雄复制器不参与羁绊", () => {
    const { state } = setup();
    const { ctx } = withTraits(state, ["garen", "duplicator"]);
    const counts = traitCountsFor(ctx.units.filter((u) => u.owner === 0));
    expect(counts.get("demacia")).toBe(1);
    expect(counts.get("vanguard")).toBe(1);
  });

  it("双方各自独立统计羁绊", () => {
    const { state, enemy } = setup();
    lineup(state, state.players[0]!, ["garen", "poppy"]);
    lineup(state, enemy, ["darius", "draven"]);
    const ctx = battleCtx(state);
    applyBattleStartTraits(ctx, 0);
    applyBattleStartTraits(ctx, 1);
    const mine = activeTraitsFor(ctx.units.filter((u) => u.owner === 0)).map((t) => t.id);
    const theirs = activeTraitsFor(ctx.units.filter((u) => u.owner === 1)).map((t) => t.id);
    expect(mine).toContain("demacia");
    expect(theirs).toContain("noxus");
    expect(mine).not.toContain("noxus");
  });

  it("每个羁绊都会产出 TRAIT_TRIGGER 事件（含 tier 与目标）", () => {
    const { state } = setup();
    lineup(state, state.players[0]!, ["garen", "poppy"]);
    place(state, state.players[1]!, "lan", 1);
    const ctx = battleCtx(state);
    const events = runBattle(ctx);
    const triggers = eventsOfType(events, "TRAIT_TRIGGER").filter((e) => e.owner === 0);
    const demacia = triggers.find((e) => e.trait === "demacia");
    expect(demacia).toBeDefined();
    expect(demacia!.tier).toBe(0);
    expect(demacia!.targets.length).toBe(2);
  });
});

describe("地区羁绊", () => {
  it("德玛西亚 2 人：全队开战 +3 护盾", () => {
    const { state } = setup();
    const { unit } = withTraits(state, ["garen", "poppy"]);
    expect(unit(0).shield).toBe(3);
    expect(unit(1).shield).toBe(3);
  });

  it("德玛西亚 4 人：护盾改为 +6，首次破盾后攻击力 +2", () => {
    const { state } = setup();
    const { ctx, uids } = withTraits(state, ["garen", "poppy", "lux", "jarvan_iv"]);
    const garen = ctx.byUid.get(uids[0]!)!;
    expect(garen.shield).toBe(6);
    expect(garen.shieldBreakAtkBuff).toBe(2);
    const before = garen.atk;
    garen.shield = 0; // 模拟护盾已被打破
    handleShieldBreak(ctx, garen);
    expect(garen.atk).toBe(before + 2);
    expect(garen.shieldBroken).toBe(true);
    handleShieldBreak(ctx, garen); // 只触发一次
    expect(garen.atk).toBe(before + 2);
  });

  it("诺克萨斯：击杀后本场攻击力 +1（4 人档 +2 并回血）", () => {
    const { state, enemy } = setup();
    const darius = place(state, state.players[0]!, "darius", 1);
    place(state, state.players[0]!, "draven", 2);
    const victim = place(state, enemy, "lan", 1);
    victim.hp = 2; // 德莱厄斯一次普攻即击杀
    const ctx = battleCtx(state);
    const events = runBattle(ctx);
    expect(ctx.byUid.get(darius.uid)!.atk).toBe(4); // 3 + 1
    const noxusTriggers = eventsOfType(events, "TRAIT_TRIGGER").filter((e) => e.trait === "noxus");
    expect(noxusTriggers.length).toBeGreaterThanOrEqual(2); // 开战一次 + 击杀一次
    expect(noxusTriggers[noxusTriggers.length - 1]!.targets).toEqual([darius.uid]);

    const s2 = setup().state;
    const r2 = withTraits(s2, ["darius", "draven", "katarina", "swain"]);
    expect(r2.unit(0).onKillAtkBuff).toBe(2);
    expect(r2.unit(0).onKillHealRatio).toBeCloseTo(0.12);
  });

  it("艾欧尼亚：全队初始法力 +20（4 人档 +35 且施法返还 15 点）", () => {
    const { state } = setup();
    const { unit } = withTraits(state, ["shen", "yasuo"]);
    const shenCfg = CARD_BY_ID.get("shen")!;
    const yasuoCfg = CARD_BY_ID.get("yasuo")!;
    expect(unit(0).mana).toBe(shenCfg.startMana + 20);
    expect(unit(1).mana).toBe(yasuoCfg.startMana + 20);

    const s2 = setup().state;
    const r2 = withTraits(s2, ["shen", "yasuo", "ahri", "irelia"]);
    expect(r2.unit(0).mana).toBe(shenCfg.startMana + 35);
    expect(r2.unit(0).castManaRefund).toBe(15);
  });

  it("皮城祖安：确定性强化 1 名友军（攻 +2 / 生命 +2），4 人档强化 2 名并 +15% 技能", () => {
    const { state, p } = setup();
    const vi = place(state, p, "vi", 2);
    const jinx = place(state, p, "jinx", 4);
    place(state, state.players[1]!, "lan", 1);
    const ctx = battleCtx(state);
    applyBattleStartTraits(ctx, 0);
    const buffed = [ctx.byUid.get(vi.uid)!, ctx.byUid.get(jinx.uid)!].filter(
      (u) => u.atk === CARD_BY_ID.get(u.configId)!.atk + 2,
    );
    expect(buffed).toHaveLength(1);
    expect(buffed[0]!.maxHp).toBe(CARD_BY_ID.get(buffed[0]!.configId)!.hp + 2);

    const s2 = setup().state;
    const r2 = withTraits(s2, ["vi", "jinx", "caitlyn", "ekko"]);
    const all = [0, 1, 2, 3].map((i) => r2.unit(i));
    expect(all.every((u) => u.skillAmp >= 0.15)).toBe(true);
    const buffedCount = all.filter((u) => u.atk === CARD_BY_ID.get(u.configId)!.atk + 2).length;
    expect(buffedCount).toBe(2);
  });

  it("皮城祖安的强化目标由派生 RNG 决定：同 seed 完全一致", () => {
    const pick = () => {
      const { state, p } = setup(777);
      const vi = place(state, p, "vi", 2);
      const jinx = place(state, p, "jinx", 4);
      place(state, state.players[1]!, "lan", 1);
      const ctx = battleCtx(state);
      applyBattleStartTraits(ctx, 0);
      return [ctx.byUid.get(vi.uid)!.atk, ctx.byUid.get(jinx.uid)!.atk];
    };
    expect(pick()).toEqual(pick());
  });

  it("暗影岛：首名友方阵亡后存活友军攻 +1（4 人档每次阵亡都触发，最多 3 层）", () => {
    const { state, enemy } = setup();
    const kalista = place(state, state.players[0]!, "kalista", 1); // 前排，5 血
    const hecarim = place(state, state.players[0]!, "hecarim", 2);
    const killer = place(state, enemy, "taitan", 1);
    killer.atk = 6; // 一击秒掉卡莉丝塔
    killer.hp = 200;
    const ctx = battleCtx(state);
    const events = runBattle(ctx);
    expect(eventsOfType(events, "DEATH").some((e) => e.who === kalista.uid)).toBe(true);
    const hec = ctx.byUid.get(hecarim.uid)!;
    expect(hec.soulStacks).toBe(1);
    expect(hec.atk).toBe(CARD_BY_ID.get("hecarim")!.atk + 1);

    const s2 = setup().state;
    const r2 = withTraits(s2, ["hecarim", "kalista", "thresh", "viego"]);
    expect(r2.unit(0).maxSoulStacks).toBe(3);
  });
});

describe("职业羁绊", () => {
  it("先锋：最大生命 +15%（4 人档 +30% 并获得 10% 最大生命护盾）", () => {
    const { state } = setup();
    const { unit } = withTraits(state, ["garen", "poppy"]);
    expect(unit(0).maxHp).toBe(Math.floor(CARD_BY_ID.get("garen")!.hp * 1.15));
    expect(unit(1).maxHp).toBe(Math.floor(CARD_BY_ID.get("poppy")!.hp * 1.15));

    const s2 = setup().state;
    const r2 = withTraits(s2, ["garen", "shen", "vi", "hecarim"]);
    const hecarim = r2.unit(3);
    const baseHp = CARD_BY_ID.get("hecarim")!.hp;
    expect(hecarim.maxHp).toBe(Math.floor(baseHp * 1.3));
    expect(hecarim.shield).toBe(Math.floor(hecarim.maxHp * 0.1));
  });

  it("战士：攻击力 +15%（4 人档 +30% 且低血减伤 20%）", () => {
    const { state } = setup();
    const { unit } = withTraits(state, ["darius", "yasuo"]);
    expect(unit(0).atk).toBe(Math.floor(CARD_BY_ID.get("darius")!.atk * 1.15));

    const s2 = setup().state;
    const r2 = withTraits(s2, ["garen", "darius", "yasuo", "irelia"]);
    const irelia = r2.unit(3);
    expect(irelia.atk).toBe(Math.floor(CARD_BY_ID.get("irelia")!.atk * 1.3));
    expect(irelia.lowHpThreshold).toBeCloseTo(0.4);
    expect(irelia.lowHpDamageReduction).toBeCloseTo(0.2);
  });

  it("法师：技能数值 +15%（4 人档 +30% 且首次施法返还 15 法力）", () => {
    // 单人伤害作为基准
    const solo = (() => {
      const { state, p, enemy } = setup(5150);
      const ahri = place(state, p, "ahri", 1);
      const foe = place(state, enemy, "taitan", 1);
      foe.hp = 100;
      const ctx = battleCtx(state);
      fillMana(ctx, ahri.uid);
      const events = runBattle(ctx);
      return eventsOfType(events, "DAMAGE").find((e) => e.source === ahri.uid)!.amount;
    })();
    // 法师 2 人羁绊
    const buffed = (() => {
      const { state, p, enemy } = setup(5150);
      const ahri = place(state, p, "ahri", 1);
      place(state, p, "lux", 2);
      const foe = place(state, enemy, "taitan", 1);
      foe.hp = 100;
      const ctx = battleCtx(state);
      fillMana(ctx, ahri.uid);
      const events = runBattle(ctx);
      return eventsOfType(events, "DAMAGE").find((e) => e.source === ahri.uid)!.amount;
    })();
    expect(solo).toBe(9);
    expect(buffed).toBe(Math.floor(9 * 1.15));

    const s2 = setup().state;
    const r2 = withTraits(s2, ["lux", "swain", "ahri", "ekko"]);
    expect(r2.unit(2).skillAmp).toBeCloseTo(0.3);
    expect(r2.unit(2).firstCastManaRefund).toBe(15);
  });

  it("射手：每第 3 次普攻追加一次 75% 攻击（4 人档每第 2 次 90%）", () => {
    const { state, p, enemy } = setup();
    const draven = place(state, p, "draven", 1); // 攻 4
    place(state, p, "jinx", 3); // 触发射手 2 人羁绊
    const foe = place(state, enemy, "lan", 1);
    foe.hp = 300; // 血量足够厚，保证德莱文能打出第 3 次普攻
    foe.atk = 1;
    const ctx = battleCtx(state);
    const events = runBattle(ctx);
    const attacks = eventsOfType(events, "ATTACK").filter((e) => e.from === draven.uid);
    expect(attacks.length).toBeGreaterThanOrEqual(4);
    expect(attacks[2]!.dmg).toBe(4);
    expect(attacks[3]!.dmg).toBe(Math.floor(4 * 0.75)); // 追加攻击

    const s2 = setup().state;
    const r2 = withTraits(s2, ["draven", "jinx", "caitlyn", "kalista"]);
    expect(r2.unit(0).extraAttackEvery).toBe(2);
    expect(r2.unit(0).extraAttackRatio).toBeCloseTo(0.9);
  });

  it("刺客：开战跳后排，首次技能 +15%（4 人档 +35%）", () => {
    const { state } = setup();
    const { ctx, unit } = withTraits(state, ["katarina", "viego"]);
    expect(unit(0).targetRule).toBe("backmost");
    expect(unit(0).firstSkillAmp).toBeCloseTo(0.15);

    const s2 = setup().state;
    const r2 = withTraits(s2, ["katarina", "yasuo", "irelia", "ekko"]);
    expect(r2.unit(0).firstSkillAmp).toBeCloseTo(0.35);
    expect(eventsOfType(r2.ctx.events, "JUMP").length).toBeGreaterThan(0);
    void ctx;
  });

  it("刺客会跳过前排直接攻击后排", () => {
    const { state, p, enemy } = setup();
    const kat = place(state, p, "katarina", 1);
    place(state, p, "viego", 2);
    const front = place(state, enemy, "taitan", 1);
    const back = place(state, enemy, "lan", 6);
    const ctx = battleCtx(state);
    const events = runBattle(ctx);
    const firstAttack = eventsOfType(events, "ATTACK").find((e) => e.from === kat.uid)!;
    expect(firstAttack.to).toBe(back.uid);
    expect(firstAttack.to).not.toBe(front.uid);
  });

  it("辅助：治疗和护盾 +20%（4 人档 +40% 且单体增益复制给另一名残血友军）", () => {
    const { state } = setup();
    const { unit } = withTraits(state, ["lux", "thresh"]);
    expect(unit(0).healShieldAmp).toBeCloseTo(0.2);
    expect(unit(1).healShieldAmp).toBeCloseTo(0.2);

    const s2 = setup().state;
    const r2 = withTraits(s2, ["lux", "jarvan_iv", "shen", "thresh"]);
    expect(r2.unit(3).healShieldAmp).toBeCloseTo(0.4);
    expect(r2.unit(3).copyBuffToExtraAlly).toBe(true);
  });

  it("辅助 4 人档会把单体护盾复制给另一名残血友军", () => {
    const { state, p, enemy } = setup();
    const thresh = place(state, p, "thresh", 4);
    const lux = place(state, p, "lux", 5);
    const jarvan = place(state, p, "jarvan_iv", 6);
    const shen = place(state, p, "shen", 3);
    place(state, enemy, "taitan", 1);
    const ctx = battleCtx(state);
    fillMana(ctx, thresh.uid);
    const events = runBattle(ctx);
    // 锤石技能：为最低生命友方提供 8/13 护盾；4 人辅助档再复制给另一名残血友军
    const gains = eventsOfType(events, "SHIELD_GAIN").filter((e) => e.source === thresh.uid);
    expect(gains.length).toBeGreaterThanOrEqual(2);
    const targets = new Set(gains.map((g) => g.target));
    expect(targets.size).toBeGreaterThanOrEqual(2);
    void lux;
    void jarvan;
    void shen;
  });
});

describe("羁绊与减伤/破盾的交互", () => {
  it("战士 4 人档：低血时受到的伤害减少 20%", () => {
    const { state, p, enemy } = setup();
    lineup(state, p, ["garen", "darius", "yasuo", "irelia"]);
    const foe = place(state, enemy, "taitan", 1);
    const ctx = battleCtx(state);
    applyBattleStartTraits(ctx, 0);
    const irelia = [...ctx.units].find((u) => u.configId === "irelia")!;
    const attacker = ctx.byUid.get(foe.uid)!;
    irelia.hp = Math.floor(irelia.maxHp * 0.3); // 低于 40%
    const r = dealDamage(ctx, attacker, irelia, 10);
    // 10 × (1 − 0.2) = 8
    expect(r.hpDamage).toBe(8);
  });
});
