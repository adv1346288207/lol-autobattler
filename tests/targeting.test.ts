import { describe, expect, it } from "vitest";
import { makeCtx, place, battleCtx } from "./helpers";
import { selectTargets } from "../core/targeting";
import { runBattle } from "../core/battle";

/**
 * 目标选择器（T1）：前排/后排/最低生命/同列/全体/友方
 * 规则：只选存活单位；后排为空回退前排；并列按 位置 → UID 破同分；只有 random_* 消耗 RNG。
 */
function setup() {
  const { state, p } = makeCtx(2024);
  return { state, p, enemy: state.players[1]! };
}

describe("目标选择器", () => {
  it("frontmost = 位置最靠前的存活敌人（前排在先）", () => {
    const { state, p, enemy } = setup();
    const front = place(state, enemy, "garen", 1);
    place(state, enemy, "lux", 4);
    const me = place(state, p, "garen", 6);
    const ctx = battleCtx(state);
    const self = ctx.byUid.get(me.uid)!;
    expect(selectTargets(ctx, "frontmost", self).map((t) => t.uid)).toEqual([front.uid]);
  });

  it("frontmost 跳过已阵亡单位", () => {
    const { state, p, enemy } = setup();
    const dead = place(state, enemy, "garen", 1);
    dead.hp = 0;
    const alive = place(state, enemy, "poppy", 2);
    const me = place(state, p, "garen", 1);
    const ctx = battleCtx(state);
    const self = ctx.byUid.get(me.uid)!;
    expect(selectTargets(ctx, "frontmost", self).map((t) => t.uid)).toEqual([alive.uid]);
  });

  it("backmost = 位置最靠后的存活敌人", () => {
    const { state, p, enemy } = setup();
    place(state, enemy, "garen", 1);
    const back = place(state, enemy, "lux", 6);
    const me = place(state, p, "garen", 1);
    const ctx = battleCtx(state);
    const self = ctx.byUid.get(me.uid)!;
    expect(selectTargets(ctx, "backmost", self).map((t) => t.uid)).toEqual([back.uid]);
  });

  it("后排为空时 backmost 回退到前排（不返回空）", () => {
    const { state, p, enemy } = setup();
    const front = place(state, enemy, "garen", 2);
    const me = place(state, p, "garen", 1);
    const ctx = battleCtx(state);
    const self = ctx.byUid.get(me.uid)!;
    expect(selectTargets(ctx, "backmost", self).map((t) => t.uid)).toEqual([front.uid]);
  });

  it("lowest_hp 取生命最低；同分按位置靠前优先", () => {
    const { state, p, enemy } = setup();
    place(state, enemy, "garen", 1); // 7 血
    const tieFront = place(state, enemy, "lux", 4);
    tieFront.hp = 1;
    const tieBack = place(state, enemy, "draven", 6);
    tieBack.hp = 1; // 同血但位置更靠后
    const me = place(state, p, "garen", 1);
    const ctx = battleCtx(state);
    const self = ctx.byUid.get(me.uid)!;
    expect(selectTargets(ctx, "lowest_hp", self).map((t) => t.uid)).toEqual([tieFront.uid]);
  });

  it("lowest_hp_backline 只看后排；后排为空时回退全场最低生命", () => {
    const { state, p, enemy } = setup();
    const frontWeak = place(state, enemy, "garen", 1);
    frontWeak.hp = 1;
    const backStrong = place(state, enemy, "lux", 5);
    backStrong.hp = 9;
    const me = place(state, p, "caitlyn", 1);
    const ctx = battleCtx(state);
    const self = ctx.byUid.get(me.uid)!;
    expect(selectTargets(ctx, "lowest_hp_backline", self).map((t) => t.uid)).toEqual([backStrong.uid]);

    // 后排清空 → 回退到全场最低生命
    backStrong.hp = 0;
    const ctx2 = battleCtx(state);
    const self2 = ctx2.byUid.get(me.uid)!;
    expect(selectTargets(ctx2, "lowest_hp_backline", self2).map((t) => t.uid)).toEqual([frontWeak.uid]);
  });

  it("same_column 选中当前目标所在整列（按位置升序）", () => {
    const { state, p, enemy } = setup();
    const col2a = place(state, enemy, "garen", 2);
    const col2b = place(state, enemy, "lux", 5);
    place(state, enemy, "poppy", 3);
    place(state, enemy, "draven", 6);
    const me = place(state, p, "hecarim", 1);
    const ctx = battleCtx(state);
    const self = ctx.byUid.get(me.uid)!;
    const anchor = ctx.byUid.get(col2b.uid)!;
    expect(selectTargets(ctx, "same_column", self, anchor).map((t) => t.uid)).toEqual([col2a.uid, col2b.uid]);
  });

  it("all_enemies 按位置升序返回全部存活敌人", () => {
    const { state, p, enemy } = setup();
    const a = place(state, enemy, "garen", 1);
    const dead = place(state, enemy, "poppy", 3);
    dead.hp = 0;
    const b = place(state, enemy, "lux", 6);
    const me = place(state, p, "garen", 1);
    const ctx = battleCtx(state);
    const self = ctx.byUid.get(me.uid)!;
    expect(selectTargets(ctx, "all_enemies", self).map((t) => t.uid)).toEqual([a.uid, b.uid]);
  });

  it("友方规则：self / lowest_hp_ally / all_allies", () => {
    const { state, p, enemy } = setup();
    place(state, enemy, "garen", 1);
    const me = place(state, p, "garen", 1);
    const weakAlly = place(state, p, "lux", 4);
    weakAlly.hp = 2;
    const ctx = battleCtx(state);
    const self = ctx.byUid.get(me.uid)!;
    expect(selectTargets(ctx, "self", self).map((t) => t.uid)).toEqual([me.uid]);
    expect(selectTargets(ctx, "lowest_hp_ally", self).map((t) => t.uid)).toEqual([weakAlly.uid]);
    expect(selectTargets(ctx, "all_allies", self).map((t) => t.uid).length).toBe(2);
  });

  it("lowest_hp 支持多目标（艾瑞莉娅：至多 N 名不同敌人）", () => {
    const { state, p, enemy } = setup();
    const u1 = place(state, enemy, "garen", 1);
    const u2 = place(state, enemy, "poppy", 2);
    const u3 = place(state, enemy, "lux", 3);
    const u4 = place(state, enemy, "draven", 4);
    u1.hp = 9;
    u2.hp = 1;
    u3.hp = 5;
    u4.hp = 3;
    const me = place(state, p, "irelia", 1);
    const ctx = battleCtx(state);
    const self = ctx.byUid.get(me.uid)!;
    const picked = selectTargets(ctx, "lowest_hp", self, null, 3).map((t) => t.uid);
    expect(picked).toEqual([u2.uid, u4.uid, u3.uid]); // 1 < 3 < 5 血
    expect(new Set(picked).size).toBe(3);
  });

  it("random_backline 只选后排，且同 seed 序列完全一致", () => {
    const build = () => {
      const { state, p, enemy } = setup();
      place(state, enemy, "garen", 1);
      place(state, enemy, "poppy", 2);
      const b1 = place(state, enemy, "lux", 4);
      const b2 = place(state, enemy, "draven", 5);
      const me = place(state, p, "katarina", 1);
      const ctx = battleCtx(state);
      const self = ctx.byUid.get(me.uid)!;
      return { ctx, self, backline: [b1.uid, b2.uid] };
    };
    const a = build();
    const b = build();
    const seqA = [0, 1, 2].map(() => selectTargets(a.ctx, "random_backline", a.self)[0]!.uid);
    const seqB = [0, 1, 2].map(() => selectTargets(b.ctx, "random_backline", b.self)[0]!.uid);
    expect(seqA).toEqual(seqB); // 同 seed → 同序列
    expect(seqA.every((uid) => a.backline.includes(uid))).toBe(true);
  });

  it("random_backline 后排为空时回退前排", () => {
    const { state, p, enemy } = setup();
    const front = place(state, enemy, "garen", 1);
    const me = place(state, p, "katarina", 1);
    const ctx = battleCtx(state);
    const self = ctx.byUid.get(me.uid)!;
    expect(selectTargets(ctx, "random_backline", self).map((t) => t.uid)).toEqual([front.uid]);
  });

  it("same_as_previous 复用上一步目标，目标已阵亡则清空", () => {
    const { state, p, enemy } = setup();
    const e1 = place(state, enemy, "garen", 1);
    const me = place(state, p, "poppy", 1);
    const ctx = battleCtx(state);
    const self = ctx.byUid.get(me.uid)!;
    const anchor = ctx.byUid.get(e1.uid)!;
    expect(selectTargets(ctx, "same_as_previous", self, anchor).map((t) => t.uid)).toEqual([e1.uid]);
    anchor.alive = false;
    expect(selectTargets(ctx, "same_as_previous", self, anchor)).toEqual([]);
  });

  it("战斗整体：同 seed 事件日志完全一致（随机目标也复现）", () => {
    const build = () => {
      const { state, p, enemy } = setup();
      place(state, p, "katarina", 1);
      place(state, p, "kalista", 2);
      place(state, enemy, "garen", 1);
      place(state, enemy, "poppy", 2);
      place(state, enemy, "lux", 5);
      return JSON.stringify(runBattle(battleCtx(state)));
    };
    expect(build()).toBe(build());
  });
});
