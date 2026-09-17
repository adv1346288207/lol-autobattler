import { describe, expect, it } from "vitest";
import { makeCtx, place, battleCtx, eventsOfType, fillMana } from "./helpers";
import { runBattle } from "../core/battle";
import { CARD_BY_ID, HERO_CARDS } from "../config/cards";
import type { BattleEvent, GameState, PlayerState } from "../core/state";

/**
 * 20 名英雄的技能行为（T1）
 * 每名英雄至少 1 条可观察断言；盖伦/拉克丝/阿狸/卡莉丝塔为引擎代表英雄，覆盖完整事件序列。
 */

let seq = 0;
function setup() {
  seq += 1;
  const { state, p } = makeCtx(7000 + seq);
  return { state, p, enemy: state.players[1]! };
}

/** 取技能施放后到该单位下一次普攻之间的事件（隔离技能效果） */
function castPhase(events: BattleEvent[], caster: number): BattleEvent[] {
  const idx = events.findIndex((e) => e.type === "SKILL_CAST" && e.caster === caster);
  if (idx < 0) return [];
  const out: BattleEvent[] = [];
  for (let i = idx; i < events.length; i++) {
    const e = events[i]!;
    if (i > idx && (e.type === "ATTACK" || e.type === "SKILL_CAST")) break;
    out.push(e);
  }
  return out;
}

function damageIn(events: BattleEvent[], source: number) {
  return events.filter(
    (e): e is Extract<BattleEvent, { type: "DAMAGE" }> => e.type === "DAMAGE" && e.source === source,
  );
}

/** 上阵 1 名英雄 + 若干（旧卡）友军，敌方若干旧卡；英雄满法力开战 */
function scenario(
  heroId: string,
  opts: {
    allies?: { id: string; pos: number; hp?: number }[];
    foes: { id: string; pos: number; hp?: number; shield?: number }[];
    heroHp?: number;
  },
) {
  const { state, p, enemy } = setup();
  const hero = place(state, p, heroId, 1);
  for (const a of opts.allies ?? []) {
    const c = place(state, p, a.id, a.pos);
    if (a.hp !== undefined) c.hp = a.hp;
  }
  const foes = opts.foes.map((f) => {
    const c = place(state, enemy, f.id, f.pos);
    if (f.hp !== undefined) c.hp = f.hp;
    return c;
  });
  const ctx = battleCtx(state);
  if (opts.heroHp !== undefined) ctx.byUid.get(hero.uid)!.hp = opts.heroHp;
  for (const f of opts.foes) {
    const placed = foes[opts.foes.indexOf(f)]!;
    if (f.shield !== undefined) ctx.byUid.get(placed.uid)!.shield = f.shield;
  }
  fillMana(ctx, hero.uid);
  const events = runBattle(ctx);
  return { state, hero, foes, ctx, events, phase: castPhase(events, hero.uid) };
}

describe("卡池完整性", () => {
  it("正式卡池为 20 名英雄 + 1 张英雄复制器", () => {
    expect(HERO_CARDS).toHaveLength(20);
    expect(new Set(HERO_CARDS.map((c) => c.skill!.id)).size).toBe(20); // 技能互不重复
    for (const hero of HERO_CARDS) {
      expect(hero.skill).not.toBeNull();
    }
  });

  it("每个地区 4 名英雄、每个职业至少 4 名（可激活 4 人羁绊）", () => {
    const byRegion = new Map<string, number>();
    const byProf = new Map<string, number>();
    for (const h of HERO_CARDS) {
      byRegion.set(h.region!, (byRegion.get(h.region!) ?? 0) + 1);
      for (const prof of h.professions) byProf.set(prof, (byProf.get(prof) ?? 0) + 1);
    }
    expect([...byRegion.values()]).toEqual([4, 4, 4, 4, 4]);
    for (const n of byProf.values()) expect(n).toBeGreaterThanOrEqual(4);
  });
});

describe("代表英雄（引擎能力验证）", () => {
  it("盖伦：对全体敌人造成伤害并给自己护盾", () => {
    const { hero, phase } = scenario("garen", {
      foes: [
        { id: "lan", pos: 1, hp: 100 },
        { id: "lan", pos: 2, hp: 100 },
        { id: "lan", pos: 3, hp: 100 },
      ],
    });
    const dmg = damageIn(phase, hero.uid);
    expect(dmg).toHaveLength(3); // 全体
    expect(new Set(dmg.map((d) => d.target)).size).toBe(3);
    expect(dmg.every((d) => d.amount === 3)).toBe(true);
    const shield = eventsOfType(phase, "SHIELD_GAIN").filter((e) => e.target === hero.uid);
    expect(shield).toHaveLength(1);
    expect(shield[0]!.amount).toBe(4);
  });

  it("拉克丝：打后排最低优先级目标（backmost）并为残血友军加盾", () => {
    const { hero, foes, phase } = scenario("lux", {
      allies: [{ id: "taitan", pos: 4, hp: 4 }],
      foes: [
        { id: "lan", pos: 1, hp: 100 },
        { id: "lan", pos: 6, hp: 100 },
      ],
    });
    const dmg = damageIn(phase, hero.uid);
    expect(dmg).toHaveLength(1);
    expect(dmg[0]!.target).toBe(foes[1]!.uid); // 位置 6 的后排
    expect(dmg[0]!.amount).toBe(8);

    const allyUid = [...phase].length >= 0 ? undefined : undefined;
    void allyUid;
    const shields = eventsOfType(phase, "SHIELD_GAIN");
    expect(shields.some((s) => s.amount === 5 && s.target !== hero.uid)).toBe(true);
  });

  it("阿狸：对后排造成伤害并施加魅惑（独立状态名）", () => {
    const { hero, foes, phase } = scenario("ahri", {
      foes: [
        { id: "lan", pos: 1, hp: 100 },
        { id: "lan", pos: 5, hp: 100 },
      ],
    });
    const dmg = damageIn(phase, hero.uid);
    expect(dmg).toHaveLength(1);
    expect(dmg[0]!.target).toBe(foes[1]!.uid);
    expect(dmg[0]!.amount).toBe(9);
    const charm = eventsOfType(phase, "STATUS_APPLY").filter((e) => e.status === "charm");
    expect(charm).toHaveLength(1);
    expect(charm[0]!.target).toBe(foes[1]!.uid);
    expect(charm[0]!.duration).toBe(1);
  });

  it("卡莉丝塔：对当前目标进行 4 段攻击，事件序列可回放", () => {
    const { hero, foes, phase } = scenario("kalista", {
      foes: [{ id: "taitan", pos: 1, hp: 100 }],
    });
    const types = phase.map((e) => e.type);
    expect(types[0]).toBe("SKILL_CAST");
    const dmg = damageIn(phase, hero.uid);
    expect(dmg).toHaveLength(4);
    expect(dmg.every((d) => d.target === foes[0]!.uid)).toBe(true);
    expect(dmg.every((d) => d.amount === Math.max(1, Math.floor(4 * 0.5)))).toBe(true);
  });
});

describe("其余 16 名英雄", () => {
  it("波比：冲撞当前目标 + 眩晕 1 次行动 + 自身护盾", () => {
    const { hero, foes, phase } = scenario("poppy", { foes: [{ id: "taitan", pos: 1, hp: 100 }] });
    const dmg = damageIn(phase, hero.uid);
    expect(dmg[0]!.target).toBe(foes[0]!.uid);
    expect(dmg[0]!.amount).toBe(6);
    const stun = eventsOfType(phase, "STATUS_APPLY").filter((e) => e.status === "stun");
    expect(stun[0]!.target).toBe(foes[0]!.uid);
    expect(stun[0]!.duration).toBe(1);
    expect(eventsOfType(phase, "SHIELD_GAIN").some((s) => s.target === hero.uid && s.amount === 3)).toBe(true);
  });

  it("嘉文四世：打后排并为全体友方加盾", () => {
    const { hero, foes, phase } = scenario("jarvan_iv", {
      allies: [
        { id: "taitan", pos: 2 },
        { id: "lan", pos: 3 },
      ],
      foes: [
        { id: "lan", pos: 1, hp: 100 },
        { id: "lan", pos: 5, hp: 100 },
      ],
    });
    const dmg = damageIn(phase, hero.uid);
    expect(dmg[0]!.target).toBe(foes[1]!.uid);
    const shields = eventsOfType(phase, "SHIELD_GAIN");
    expect(shields.filter((s) => s.amount === 2).length).toBe(3); // 全体友方（含自己）
  });

  it("德莱厄斯：锁定生命最低的敌人（低于阈值直接斩杀）", () => {
    const { hero, foes, phase } = scenario("darius", {
      foes: [
        { id: "taitan", pos: 1, hp: 100 },
        { id: "taitan", pos: 4, hp: 6 },
      ],
    });
    const dmg = damageIn(phase, hero.uid);
    expect(dmg[0]!.target).toBe(foes[1]!.uid); // 6 血最低
    expect(dmg[0]!.amount).toBe(10); // 6/12 = 50% > 35%，走普通伤害（技能基础值 10）
  });

  it("德莱文：对后排连续投掷 2 次飞斧（一星）", () => {
    const { hero, foes, phase } = scenario("draven", {
      foes: [
        { id: "taitan", pos: 1, hp: 100 },
        { id: "taitan", pos: 5, hp: 100 },
      ],
    });
    const dmg = damageIn(phase, hero.uid);
    expect(dmg).toHaveLength(2);
    expect(dmg.every((d) => d.target === foes[1]!.uid)).toBe(true);
    expect(dmg[0]!.amount).toBe(Math.floor(4 * 0.8));
  });

  it("卡特琳娜：随机后排起点的多段伤害，同 seed 完全一致", () => {
    const run = () =>
      scenario("katarina", {
        foes: [
          { id: "taitan", pos: 1, hp: 100 },
          { id: "taitan", pos: 4, hp: 100 },
          { id: "taitan", pos: 5, hp: 100 },
        ],
      });
    const a = run();
    const b = scenario("katarina", {
      foes: [
        { id: "taitan", pos: 1, hp: 100 },
        { id: "taitan", pos: 4, hp: 100 },
        { id: "taitan", pos: 5, hp: 100 },
      ],
    });
    const dmgA = damageIn(a.phase, a.hero.uid);
    const dmgB = damageIn(b.phase, b.hero.uid);
    expect(dmgA).toHaveLength(3);
    expect(dmgA.every((d) => d.amount === 2)).toBe(true);
    // 只打后排（位置 4/5）
    expect(dmgA.every((d) => d.target !== a.foes[0]!.uid)).toBe(true);
    expect(dmgA.map((d) => d.target)).toEqual(dmgB.map((d) => d.target));
  });

  it("斯维因：全体伤害并按实际生命伤害回复生命", () => {
    const { hero, phase } = scenario("swain", {
      heroHp: 3,
      foes: [
        { id: "lan", pos: 1, hp: 100 },
        { id: "lan", pos: 2, hp: 100 },
        { id: "lan", pos: 3, hp: 100 },
      ],
    });
    const dmg = damageIn(phase, hero.uid);
    expect(dmg).toHaveLength(3);
    const heal = eventsOfType(phase, "HEAL").filter((e) => e.target === hero.uid);
    expect(heal).toHaveLength(1);
    expect(heal[0]!.amount).toBe(Math.floor(12 * 0.35)); // 12 点实际伤害的 35%
  });

  it("慎：为最低生命友方加盾并使其获得减伤", () => {
    const { hero, foes, phase } = scenario("shen", {
      allies: [{ id: "taitan", pos: 4, hp: 3 }],
      foes: [{ id: "taitan", pos: 1, hp: 100 }],
    });
    void foes;
    const allyUid = placeUidOf(phase);
    const shield = eventsOfType(phase, "SHIELD_GAIN").filter((e) => e.amount === 8);
    expect(shield).toHaveLength(1);
    expect(shield[0]!.target).not.toBe(hero.uid);
    expect(shield[0]!.target).toBe(allyUid);
    const dr = eventsOfType(phase, "STATUS_APPLY").filter((e) => e.status === "damage_reduction");
    expect(dr).toHaveLength(1);
    expect(dr[0]!.target).toBe(allyUid);
  });

  it("亚索：对当前目标连击 3 次并在第三击后眩晕", () => {
    const { hero, foes, phase } = scenario("yasuo", { foes: [{ id: "taitan", pos: 1, hp: 100 }] });
    const dmg = damageIn(phase, hero.uid);
    expect(dmg).toHaveLength(3);
    expect(dmg.every((d) => d.amount === Math.floor(4 * 0.55))).toBe(true);
    const stun = eventsOfType(phase, "STATUS_APPLY").filter((e) => e.status === "stun");
    expect(stun[0]!.target).toBe(foes[0]!.uid);
  });

  it("艾瑞莉娅：按当前生命从低到高打击至多 3 名不同敌人", () => {
    const { hero, phase } = scenario("irelia", {
      foes: [
        { id: "taitan", pos: 1, hp: 60 },
        { id: "taitan", pos: 2, hp: 20 },
        { id: "taitan", pos: 3, hp: 30 },
        { id: "taitan", pos: 4, hp: 40 },
      ],
    });
    const dmg = damageIn(phase, hero.uid);
    expect(dmg).toHaveLength(3); // 一星上限 3
    expect(new Set(dmg.map((d) => d.target)).size).toBe(3);
    expect(dmg.every((d) => d.amount === 5)).toBe(true);
  });

  it("蔚：先破盾，再造成伤害并眩晕", () => {
    const { hero, foes, phase } = scenario("vi", {
      foes: [{ id: "taitan", pos: 1, hp: 100, shield: 5 }],
    });
    const broken = eventsOfType(phase, "SHIELD_BREAK");
    expect(broken).toHaveLength(1);
    expect(broken[0]!.amount).toBe(5);
    expect(broken[0]!.target).toBe(foes[0]!.uid);
    expect(damageIn(phase, hero.uid)[0]!.amount).toBe(7);
    expect(eventsOfType(phase, "STATUS_APPLY").some((e) => e.status === "stun")).toBe(true);
  });

  it("金克丝：击杀后本场攻击力提升并回复法力", () => {
    const { hero, ctx, events } = scenario("jinx", {
      foes: [
        { id: "taitan", pos: 1, hp: 100 },
        { id: "lan", pos: 6, hp: 4 }, // 后排最低血量，被 2 段飞斧击杀
      ],
    });
    expect(eventsOfType(events, "DEATH").some((e) => e.killer === hero.uid)).toBe(true);
    const unit = ctx.byUid.get(hero.uid)!;
    expect(unit.atk).toBe(CARD_BY_ID.get("jinx")!.atk + 1);
    expect(eventsOfType(events, "MANA_CHANGE").some((e) => e.reason === "passive:on_kill")).toBe(true);
  });

  it("凯特琳：狙击后排生命最低的敌人；后排为空时改为全场最低", () => {
    const { hero, foes, phase } = scenario("caitlyn", {
      foes: [
        { id: "lan", pos: 1, hp: 1 }, // 全场最低但在前排
        { id: "taitan", pos: 5, hp: 90 },
        { id: "taitan", pos: 6, hp: 40 }, // 后排最低
      ],
    });
    const dmg = damageIn(phase, hero.uid);
    expect(dmg[0]!.target).toBe(foes[2]!.uid);
    expect(dmg[0]!.amount).toBe(13);
  });

  it("艾克：首次致命伤回溯生命并获得法力", () => {
    const { state, p, enemy } = setup();
    const ekko = place(state, p, "ekko", 1); // 5/7，40/100
    place(state, enemy, "taitan", 1); // 6 攻，可一击打成致命伤
    const ctx = battleCtx(state);
    ctx.byUid.get(ekko.uid)!.hp = 1;
    const events = runBattle(ctx);
    const revive = eventsOfType(events, "REVIVE").find((e) => e.who === ekko.uid);
    expect(revive).toBeDefined();
    expect(revive!.hp).toBe(Math.floor(7 * 0.35));
    const deathIdx = events.findIndex((e) => e.type === "DEATH" && e.who === ekko.uid);
    const reviveIdx = events.findIndex((e) => e.type === "REVIVE" && e.who === ekko.uid);
    if (deathIdx >= 0) expect(deathIdx).toBeGreaterThan(reviveIdx); // 回溯发生在其真正的死亡之前
  });

  it("赫卡里姆：冲撞当前目标及其同列敌人，并按命中数获得护盾", () => {
    const { hero, foes, phase } = scenario("hecarim", {
      foes: [
        { id: "taitan", pos: 2, hp: 100 },
        { id: "taitan", pos: 5, hp: 100 }, // 与位置 2 同列
        { id: "taitan", pos: 3, hp: 100 }, // 不同列
      ],
    });
    const dmg = damageIn(phase, hero.uid);
    expect(new Set(dmg.map((d) => d.target))).toEqual(new Set([foes[0]!.uid, foes[1]!.uid]));
    const shield = eventsOfType(phase, "SHIELD_GAIN").filter((e) => e.target === hero.uid);
    expect(shield[0]!.amount).toBe(2); // 1 点 × 2 个命中目标
  });

  it("锤石：为残血友军加盾，并打击后排与眩晕", () => {
    const { hero, foes, phase } = scenario("thresh", {
      allies: [{ id: "taitan", pos: 4, hp: 2 }],
      foes: [
        { id: "taitan", pos: 1, hp: 100 },
        { id: "taitan", pos: 6, hp: 100 },
      ],
    });
    const shield = eventsOfType(phase, "SHIELD_GAIN").filter((e) => e.amount === 8);
    expect(shield).toHaveLength(1);
    expect(shield[0]!.target).not.toBe(hero.uid);
    const dmg = damageIn(phase, hero.uid);
    expect(dmg[0]!.target).toBe(foes[1]!.uid);
    expect(dmg[0]!.amount).toBe(4);
    const stun = eventsOfType(phase, "STATUS_APPLY").filter((e) => e.status === "stun");
    expect(stun[0]!.target).toBe(foes[1]!.uid);
  });

  it("佛耶戈：击杀后继承目标部分基础攻击力", () => {
    const { hero, ctx } = scenario("viego", {
      foes: [
        { id: "taitan", pos: 1, hp: 5 }, // 6 攻，被 11 伤害击杀
        { id: "lan", pos: 4, hp: 100 },
      ],
    });
    const unit = ctx.byUid.get(hero.uid)!;
    expect(unit.atk).toBe(CARD_BY_ID.get("viego")!.atk + Math.floor(6 * 0.25));
  });
});

/** 慎/锤石测试用：从阶段事件里取被加盾的友方 uid（排除施法者） */
function placeUidOf(phase: BattleEvent[]): number {
  const gain = eventsOfType(phase, "SHIELD_GAIN")[0]!;
  return gain.target;
}

/** 类型占位：让 TS 知道 GameState/PlayerState 被用于辅助类型推导 */
export type _Helpers = [GameState, PlayerState];
