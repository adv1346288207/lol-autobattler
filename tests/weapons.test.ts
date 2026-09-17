import { describe, expect, it } from "vitest";
import { makeCtx, giveHand, place, battleCtx, eventsOfType } from "./helpers";
import { runCombineChecks } from "../core/combine";
import { runBattle } from "../core/battle";
import { applyBattleStartTraits } from "../core/traits";
import { dealDamage, triggerPassives } from "../core/effects";
import { CARD_BY_ID, CARD_POOL, WEAPON_CARDS } from "../config/cards";
import { validateConfig } from "../config/validate";
import { rollShop } from "../core/shop";
import { applyAction } from "../core/actions";
import { totalAtk, totalHp, type PlayerState } from "../core/state";
import { createRng } from "../core/rng";

/**
 * 武器 = 装备（T-E）
 * 规则：进商店、可买卖、3 张同名合成二星；**装备在英雄身上**（每名英雄 1 件），
 * 不占手牌也不占上阵位；武器不参与羁绊；金色武器是武器线的万能牌。
 */
const REAL = "infinity_edge"; // 无尽之刃（紫）9/6
const WILD = "hextech_gunblade"; // 海克斯科技枪刃（金，武器万能牌）8/6
const HERO_WILD = "duplicator"; // 英雄复制器（金，英雄线万能牌）

const rng = () => createRng(12345);

/** 直接往武器库存塞一张武器（跳过购买） */
function giveWeapon(state: ReturnType<typeof makeCtx>["state"], p: PlayerState, configId: string, level: 1 | 2 = 1) {
  const cfg = CARD_BY_ID.get(configId)!;
  const w = { uid: state.nextUid++, configId, level, atk: cfg.atk * (level === 2 ? 3 : 1), hp: cfg.hp * (level === 2 ? 3 : 1) };
  p.weapons.push(w);
  return w;
}

describe("武器卡池与配置", () => {
  it("配置校验通过（含武器规则）", () => {
    expect(validateConfig()).toEqual([]);
  });

  it("武器不进羁绊：没有地区、没有职业、没有主动技能与法力", () => {
    for (const w of WEAPON_CARDS) {
      expect(w.region).toBeNull();
      expect(w.professions).toEqual([]);
      expect(w.skill).toBeNull();
      expect(w.maxMana).toBe(0);
      expect(w.atk).toBeGreaterThan(0);
    }
  });

  it("五个品质档都有武器，且金色武器恰好一张（武器线万能牌）", () => {
    for (const q of ["green", "blue", "purple", "orange", "gold"] as const) {
      expect(WEAPON_CARDS.some((w) => w.quality === q)).toBe(true);
    }
    const gold = WEAPON_CARDS.filter((w) => w.quality === "gold");
    expect(gold).toHaveLength(1);
    expect(gold[0]!.wildcard).toBe("weapon");
  });

  it("武器都在正式卡池里（商店能刷到）", () => {
    for (const w of WEAPON_CARDS) expect(CARD_POOL.some((c) => c.id === w.id)).toBe(true);
    const { state, rng: r, p } = makeCtx(7);
    const seen = new Set<string>();
    for (let level = 1; level <= 5; level++) {
      p.shopLevel = level;
      for (let i = 0; i < 400; i++) {
        rollShop(state, r, p);
        for (const id of p.shop) seen.add(id!);
      }
    }
    expect(WEAPON_CARDS.filter((w) => seen.has(w.id)).length).toBeGreaterThan(0);
  });
});

describe("购买武器 → 进武器库存（不占手牌与上阵位）", () => {
  it("买武器后进 weapons，手牌不变", () => {
    const { state, p } = makeCtx(8);
    p.gold = 99;
    p.shop = [REAL, null, null];
    applyAction(state, rng(), { type: "buy", player: 0, shopIndex: 0 });
    expect(p.weapons.some((w) => w.configId === REAL)).toBe(true);
    expect(p.hand).toHaveLength(0);
    expect(p.gold).toBe(99 - CARD_BY_ID.get(REAL)!.price);
  });

  it("武器不能上阵（move 不接受武器 uid）", () => {
    const { state, p } = makeCtx(9);
    const w = giveWeapon(state, p, REAL);
    expect(() => applyAction(state, rng(), { type: "move", player: 0, cardUid: w.uid, position: 1 })).toThrow();
    expect(p.board.every((c) => c === null)).toBe(true);
  });

  it("武器库存满了会拒绝购买", () => {
    const { state, p } = makeCtx(10);
    p.gold = 99;
    p.shop = [REAL, null, null];
    for (let i = 0; i < 8; i++) giveWeapon(state, p, "long_sword");
    expect(() => applyAction(state, rng(), { type: "buy", player: 0, shopIndex: 0 })).toThrow(/武器库已满/);
  });

  it("武器能从库存直接出售", () => {
    const { state, p } = makeCtx(11);
    const w = giveWeapon(state, p, REAL);
    applyAction(state, rng(), { type: "sell", player: 0, cardUid: w.uid });
    expect(p.weapons).toHaveLength(0);
    expect(p.gold).toBe(CARD_BY_ID.get(REAL)!.price);
  });
});

describe("武器三合一（在武器库存内）", () => {
  it("3 张同名武器 → 二星武器（攻血为三张之和）", () => {
    const { state, p } = makeCtx(1);
    const base = CARD_BY_ID.get(REAL)!;
    giveWeapon(state, p, REAL);
    giveWeapon(state, p, REAL);
    giveWeapon(state, p, REAL);
    const events = runCombineChecks(state, p);
    expect(events).toHaveLength(1);
    expect(p.weapons).toHaveLength(1);
    expect(p.weapons[0]!.level).toBe(2);
    expect(p.weapons[0]!.atk).toBe(base.atk * 3);
    expect(p.weapons[0]!.hp).toBe(base.hp * 3);
  });

  it("2 张真武器 + 1 张金武器 → 二星武器", () => {
    const { state, p } = makeCtx(2);
    giveWeapon(state, p, REAL);
    giveWeapon(state, p, REAL);
    giveWeapon(state, p, WILD);
    expect(runCombineChecks(state, p)).toHaveLength(1);
    expect(p.weapons).toHaveLength(1);
    expect(p.weapons[0]!.level).toBe(2);
    expect(p.weapons[0]!.configId).toBe(REAL);
  });

  it("1 张真武器 + 2 张金武器 → 也能合成二星武器", () => {
    const { state, p } = makeCtx(3);
    giveWeapon(state, p, REAL);
    giveWeapon(state, p, WILD);
    giveWeapon(state, p, WILD);
    expect(runCombineChecks(state, p)).toHaveLength(1);
    expect(p.weapons).toHaveLength(1);
    expect(p.weapons[0]!.level).toBe(2);
    expect(p.weapons[0]!.configId).toBe(REAL);
  });

  it("英雄复制器不能补武器（两条万能线不互通）", () => {
    const { state, p } = makeCtx(4);
    giveWeapon(state, p, REAL);
    giveWeapon(state, p, REAL);
    giveHand(state, p, HERO_WILD);
    expect(runCombineChecks(state, p)).toEqual([]);
    expect(p.weapons.every((w) => w.level === 1)).toBe(true);
  });

  it("金武器不能补英雄，也不会自己合成", () => {
    const { state, p } = makeCtx(5);
    place(state, p, "garen", 1);
    giveHand(state, p, "garen");
    giveWeapon(state, p, WILD);
    expect(runCombineChecks(state, p)).toEqual([]);
    expect(p.board[0]!.level).toBe(1);

    const { state: s2, p: p2 } = makeCtx(6);
    giveWeapon(s2, p2, WILD);
    giveWeapon(s2, p2, WILD);
    giveWeapon(s2, p2, WILD);
    expect(runCombineChecks(s2, p2)).toEqual([]);
    expect(p2.weapons).toHaveLength(3);
  });
});

describe("武器被动（装备后并入英雄）", () => {
  /** 造一场：我的英雄带指定武器 vs 一个陪练 */
  function withWeapon(seed: number, weaponId: string, heroId = "garen") {
    const ctx0 = makeCtx(seed);
    const hero = place(ctx0.state, ctx0.p, heroId, 1);
    const w = giveWeapon(ctx0.state, ctx0.p, weaponId);
    applyAction(ctx0.state, rng(), { type: "equip", player: 0, weaponUid: w.uid, cardUid: hero.uid });
    place(ctx0.state, ctx0.state.players[1]!, "garen", 1);
    const ctx = battleCtx(ctx0.state);
    return { ctx, me: ctx.byUid.get(hero.uid)!, foe: ctx.units.find((u) => u.owner === 1)!, hero };
  }

  it("无尽的被动并入英雄：被动数量 = 英雄自身 + 武器", () => {
    const { me } = withWeapon(40, "infinity_edge");
    expect(me.passives).toHaveLength(1);
    expect(me.passives[0]!.trigger).toBe("on_kill");
    expect(me.passives[0]!.effect).toBe("attack_buff");
  });

  it("不带被动的武器（长剑）不会凭空多出被动", () => {
    const { me } = withWeapon(41, "long_sword");
    expect(me.passives).toHaveLength(0);
  });

  it("开战类被动：锁子甲开战给护盾", () => {
    const { ctx, me } = withWeapon(42, "chain_vest");
    triggerPassives(ctx, me, "on_battle_start");
    expect(me.shield).toBeGreaterThan(0);
  });

  it("runBattle 会在开战时自动触发 on_battle_start 被动（回归：以前没人触发）", () => {
    const { state, p } = makeCtx(48);
    const hero = place(state, p, "garen", 1);
    const w = giveWeapon(state, p, "recurve_bow");
    applyAction(state, rng(), { type: "equip", player: 0, weaponUid: w.uid, cardUid: hero.uid });
    place(state, state.players[1]!, "garen", 1);
    const events = runBattle(battleCtx(state));
    const snap = eventsOfType(events, "BATTLE_START")[0]!.boards.a.find((u) => u.uid === hero.uid)!;
    // 盖伦自身 + 反曲之弓 + 开战被动 +1 攻
    expect(snap.atk).toBe(CARD_BY_ID.get("garen")!.atk + CARD_BY_ID.get("recurve_bow")!.atk + 1);
  });

  it("致命伤回溯：守护天使让英雄死而复生", () => {
    const { ctx, me, foe } = withWeapon(43, "guardian_angel");
    me.hp = 1;
    const result = dealDamage(ctx, foe, me, 999);
    expect(result.killed).toBe(false);
    const revive = ctx.events.find((e) => e.type === "REVIVE");
    expect(revive).toBeTruthy();
    expect(me.alive).toBe(true);
    expect(me.hp).toBeGreaterThan(0);
  });

  it("首次击杀成长：无尽之刃击杀后攻击提升", () => {
    const { ctx, me, foe } = withWeapon(44, "infinity_edge");
    const before = me.atk;
    foe.hp = 1;
    foe.maxHp = 1;
    dealDamage(ctx, me, foe, 999); // 击杀 → 触发 on_kill 被动
    triggerPassives(ctx, me, "on_kill", foe);
    expect(me.atk).toBeGreaterThan(before);
  });

  it("首次施法成长：灭世者的死亡之帽施法后加攻", () => {
    const { ctx, me } = withWeapon(45, "rabadons_deathcap");
    const before = me.atk;
    triggerPassives(ctx, me, "on_skill_cast");
    expect(me.atk).toBeGreaterThan(before);
  });

  it("二星武器的被动数值更高（一星/二星档）", () => {
    const one = withWeapon(46, "infinity_edge");
    const two = withWeapon(47, "infinity_edge");
    two.me.level = 2;
    const gain = (u: typeof one.me) => {
      const before = u.atk;
      triggerPassives(one.ctx, u, "on_kill", null);
      return u.atk - before;
    };
    void gain;
    // 直接比较配置里的两档数值
    const cfg = CARD_BY_ID.get("infinity_edge")!.passives[0]!;
    expect(cfg.value).toEqual([3, 6]);
  });
});

describe("装备到英雄身上", () => {
  it("装备后 totalAtk/totalHp 含武器加成，英雄自身数值不变", () => {
    const { state, p } = makeCtx(20);
    const hero = place(state, p, "garen", 1);
    const w = giveWeapon(state, p, REAL);
    const baseAtk = hero.atk;
    const baseHp = hero.hp;
    applyAction(state, rng(), { type: "equip", player: 0, weaponUid: w.uid, cardUid: hero.uid });
    expect(hero.atk).toBe(baseAtk); // 自身数值不变
    expect(hero.hp).toBe(baseHp);
    expect(hero.equips[0]?.configId).toBe(REAL);
    expect(totalAtk(hero)).toBe(baseAtk + CARD_BY_ID.get(REAL)!.atk);
    expect(totalHp(hero)).toBe(baseHp + CARD_BY_ID.get(REAL)!.hp);
    expect(p.weapons).toHaveLength(0);
  });

  it("两个武器槽可以同时装备，装满后再装备才替换（被替换的退回库存）", () => {
    const { state, p } = makeCtx(21);
    const hero = place(state, p, "garen", 1);
    const w1 = giveWeapon(state, p, "long_sword"); // 3*2+3 = 9
    const w2 = giveWeapon(state, p, "cloth_armor"); // 1*2+6 = 8
    const w3 = giveWeapon(state, p, REAL); // 8*2+6 = 22
    applyAction(state, rng(), { type: "equip", player: 0, weaponUid: w1.uid, cardUid: hero.uid });
    applyAction(state, rng(), { type: "equip", player: 0, weaponUid: w2.uid, cardUid: hero.uid });
    expect(hero.equips.map((e) => e.configId)).toEqual(["long_sword", "cloth_armor"]);
    expect(p.weapons).toHaveLength(1);

    // 两个槽都满了：替换较弱的一件（布甲 8 < 长剑 9）
    applyAction(state, rng(), { type: "equip", player: 0, weaponUid: w3.uid, cardUid: hero.uid });
    expect(hero.equips.map((e) => e.configId).sort()).toEqual(["infinity_edge", "long_sword"]);
    expect(p.weapons.map((w) => w.configId)).toEqual(["cloth_armor"]);
  });

  it("卸下装备退回库存", () => {
    const { state, p } = makeCtx(22);
    const hero = place(state, p, "garen", 1);
    const w = giveWeapon(state, p, REAL);
    applyAction(state, rng(), { type: "equip", player: 0, weaponUid: w.uid, cardUid: hero.uid });
    applyAction(state, rng(), { type: "unequip", player: 0, cardUid: hero.uid, weaponUid: w.uid });
    expect(hero.equips).toHaveLength(0);
    expect(p.weapons.map((x) => x.configId)).toEqual([REAL]);
  });

  it("手牌里的英雄也能提前装备", () => {
    const { state, p } = makeCtx(23);
    const hero = giveHand(state, p, "ahri");
    const w = giveWeapon(state, p, REAL);
    applyAction(state, rng(), { type: "equip", player: 0, weaponUid: w.uid, cardUid: hero.uid });
    expect(hero.equips[0]?.configId).toBe(REAL);
    expect(totalAtk(hero)).toBeGreaterThan(CARD_BY_ID.get("ahri")!.atk);
  });

  it("英雄复制器不能装备武器", () => {
    const { state, p } = makeCtx(24);
    const dup = giveHand(state, p, HERO_WILD);
    const w = giveWeapon(state, p, REAL);
    expect(() => applyAction(state, rng(), { type: "equip", player: 0, weaponUid: w.uid, cardUid: dup.uid })).toThrow(
      /不能装备/,
    );
    expect(p.weapons).toHaveLength(1);
  });

  it("卖掉带装备的英雄：武器退回武器库，金币只算英雄的价（回归 bug：装备曾凭空消失）", () => {
    const { state, p } = makeCtx(70);
    const hero = place(state, p, "garen", 1);
    const w1 = giveWeapon(state, p, REAL);
    const w2 = giveWeapon(state, p, "long_sword");
    applyAction(state, rng(), { type: "equip", player: 0, weaponUid: w1.uid, cardUid: hero.uid });
    applyAction(state, rng(), { type: "equip", player: 0, weaponUid: w2.uid, cardUid: hero.uid });
    expect(hero.equips).toHaveLength(2);

    const goldBefore = p.gold;
    applyAction(state, rng(), { type: "sell", player: 0, cardUid: hero.uid });

    expect(p.board[0]).toBeNull();
    // 两件装备必须回到武器库
    expect(p.weapons.map((w) => w.configId).sort()).toEqual(["infinity_edge", "long_sword"]);
    // 只按英雄自己的价格返钱（装备没被卖掉，而是留着了）
    expect(p.gold).toBe(goldBefore + CARD_BY_ID.get("garen")!.price);
  });

  it("武器库满了再卖带装备的英雄：装备按售价折成金币，仍然不凭空消失", () => {
    const { state, p } = makeCtx(71);
    const hero = place(state, p, "garen", 1);
    const w = giveWeapon(state, p, REAL);
    applyAction(state, rng(), { type: "equip", player: 0, weaponUid: w.uid, cardUid: hero.uid });
    // 把武器库塞满
    for (let i = 0; i < 8; i++) giveWeapon(state, p, "long_sword");
    expect(p.weapons).toHaveLength(8);

    const goldBefore = p.gold;
    applyAction(state, rng(), { type: "sell", player: 0, cardUid: hero.uid });
    const heroPrice = CARD_BY_ID.get("garen")!.price;
    const weaponPrice = CARD_BY_ID.get(REAL)!.price;
    expect(p.gold).toBe(goldBefore + heroPrice + weaponPrice);
    expect(p.weapons).toHaveLength(8);
  });

  it("卖掉手牌里的英雄同样会退回装备", () => {
    const { state, p } = makeCtx(72);
    const hero = giveHand(state, p, "ahri");
    const w = giveWeapon(state, p, REAL);
    applyAction(state, rng(), { type: "equip", player: 0, weaponUid: w.uid, cardUid: hero.uid });
    applyAction(state, rng(), { type: "sell", player: 0, cardUid: hero.uid });
    expect(p.hand).toHaveLength(0);
    expect(p.weapons.map((x) => x.configId)).toEqual([REAL]);
  });

  it("AI 会给空槽的英雄装武器，两个槽满了之后才替换", async () => {
    const { state, p } = makeCtx(60);
    const { createBot } = await import("../bot/random");
    const hero = place(state, p, "garen", 1);
    p.shop = [null, null, null];
    p.shopDone = false;
    // 空槽 + 一件武器 → AI 应该装备
    giveWeapon(state, p, "long_sword");
    const bot = createBot(1, 0);
    const first = bot.decide(state, 0);
    expect(first.type).toBe("equip");
    applyAction(state, rng(), first as never);
    expect(hero.equips.map((e) => e.configId)).toEqual(["long_sword"]);

    // 还有一个空槽 → 继续装（不替换）
    giveWeapon(state, p, "cloth_armor");
    const second = bot.decide(state, 0);
    expect(second.type).toBe("equip");
    applyAction(state, rng(), second as never);
    expect(hero.equips).toHaveLength(2);

    // 两个槽都满了 → 只有明显更强时才替换最弱的一件（布甲 8）
    giveWeapon(state, p, "blade_of_the_ruined_king");
    const third = bot.decide(state, 0);
    expect(third.type).toBe("equip");
    applyAction(state, rng(), third as never);
    expect(hero.equips.map((e) => e.configId).sort()).toEqual(["blade_of_the_ruined_king", "long_sword"]);
    expect(p.weapons.map((w) => w.configId)).toEqual(["cloth_armor"]);
  });

  it("装备加成会带进战斗快照", () => {
    const { state, p } = makeCtx(25);
    const enemy = state.players[1]!;
    const hero = place(state, p, "garen", 1);
    const w = giveWeapon(state, p, REAL);
    applyAction(state, rng(), { type: "equip", player: 0, weaponUid: w.uid, cardUid: hero.uid });
    place(state, enemy, "garen", 1);
    const events = runBattle(battleCtx(state));
    const start = eventsOfType(events, "BATTLE_START")[0]!;
    const snap = start.boards.a.find((u) => u.uid === hero.uid)!;
    expect(snap.atk).toBe(CARD_BY_ID.get("garen")!.atk + CARD_BY_ID.get(REAL)!.atk);
    expect(snap.maxHp).toBe(CARD_BY_ID.get("garen")!.hp + CARD_BY_ID.get(REAL)!.hp);
  });

  it("英雄三合一时，被吃掉的两张身上的装备退回库存", () => {
    const { state, p } = makeCtx(26);
    const a = place(state, p, "garen", 1);
    const b = place(state, p, "garen", 2);
    const c = place(state, p, "garen", 3);
    const wa = giveWeapon(state, p, "long_sword");
    const wb = giveWeapon(state, p, "dagger");
    const wc = giveWeapon(state, p, "cloth_armor");
    applyAction(state, rng(), { type: "equip", player: 0, weaponUid: wa.uid, cardUid: a.uid });
    applyAction(state, rng(), { type: "equip", player: 0, weaponUid: wb.uid, cardUid: b.uid });
    applyAction(state, rng(), { type: "equip", player: 0, weaponUid: wc.uid, cardUid: c.uid });
    const events = runCombineChecks(state, p);
    expect(events).toHaveLength(1);
    const gold = p.board[0]!;
    expect(gold.level).toBe(2);
    // 锚点（位置 1）的装备保留，另外两件退回库存
    expect(gold.equips[0]?.configId).toBe("long_sword");
    expect(p.weapons.map((w) => w.configId).sort()).toEqual(["cloth_armor", "dagger"]);
    void b;
    void c;
  });
});
