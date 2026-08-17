import { describe, expect, it } from "vitest";
import { makeCtx, place } from "./helpers";
import { simulateBattle } from "../core/battle";
import { applyBattleResult } from "../core/damage";

describe("战斗模拟", () => {
  it("1v1 交替攻击：2攻5血 对 1攻10血 → A 胜、存活 1 血", () => {
    const { state, p } = makeCtx();
    const a = place(state, p, "lan", 1); // 2/2 —— 手动改数值
    a.atk = 2;
    a.hp = 5;
    const other = state.players[1]!;
    const b = place(state, other, "lan", 1);
    b.atk = 1;
    b.hp = 10;

    const events = simulateBattle(state, 0, 1);
    const end = events[events.length - 1]!;
    expect(end.type).toBe("BATTLE_END");
    if (end.type !== "BATTLE_END") return;
    expect(end.winner).toBe(0);
    expect(end.survivors).toHaveLength(1);
    expect(end.survivors[0]!.cardUid).toBe(a.uid);
    expect(end.survivors[0]!.hp).toBe(1);
    const attacks = events.filter((e) => e.type === "ATTACK");
    expect(attacks).toHaveLength(9); // A 打 5 次、B 打 4 次
  });

  it("攻击目标 = 对方最前排存活单位", () => {
    const { state, p } = makeCtx();
    const a1 = place(state, p, "lan", 1);
    a1.atk = 10;
    a1.hp = 99;
    const a4 = place(state, p, "lan", 4);
    a4.atk = 1;
    a4.hp = 99;
    const other = state.players[1]!;
    const b1 = place(state, other, "loey", 1);
    b1.atk = 1;
    b1.hp = 5;
    const b4 = place(state, other, "loey", 4);
    b4.atk = 1;
    b4.hp = 50;

    const events = simulateBattle(state, 0, 1);
    const attacks = events.filter((e) => e.type === "ATTACK");
    // b1 死前所有攻击都指向 b1（5 血被 10 攻一击带走）
    expect(attacks[0]! as { to: number }).toMatchObject({ to: b1.uid });
    // b1 死后，A 的攻击转向 b4
    const after = attacks.filter((e) => (e as { to: number }).to === b4.uid);
    expect(after.length).toBeGreaterThan(0);
    // B 的攻击全部打 A 的前排 a1
    const bAttacks = attacks.filter((e) => (e as { from: number }).from === b1.uid || (e as { from: number }).from === b4.uid);
    expect(bAttacks.every((e) => (e as { to: number }).to === a1.uid)).toBe(true);
  });

  it("空板 vs 有卡 → 有卡方无伤获胜、无攻击事件", () => {
    const { state } = makeCtx();
    const other = state.players[1]!;
    place(state, other, "swat", 1);
    const events = simulateBattle(state, 0, 1);
    const end = events[events.length - 1]!;
    expect(end.type).toBe("BATTLE_END");
    if (end.type !== "BATTLE_END") return;
    expect(end.winner).toBe(1);
    expect(events.filter((e) => e.type === "ATTACK")).toHaveLength(0);
  });

  it("双方空板 → 平局（winner=null）", () => {
    const { state } = makeCtx();
    const events = simulateBattle(state, 0, 1);
    const end = events[events.length - 1]!;
    expect(end.type).toBe("BATTLE_END");
    if (end.type !== "BATTLE_END") return;
    expect(end.winner).toBeNull();
  });

  it("战斗在快照上进行：不污染场上卡牌血量", () => {
    const { state, p } = makeCtx();
    const a = place(state, p, "lan", 1); // 2/2
    const other = state.players[1]!;
    const b = place(state, other, "loey", 1); // 1/5
    simulateBattle(state, 0, 1);
    expect(a.hp).toBe(2); // 真实场上未变
    expect(b.hp).toBe(5);
  });
});

describe("伤害结算与淘汰", () => {
  it("平局双方各扣 3", () => {
    const { state } = makeCtx();
    const events = simulateBattle(state, 0, 1); // 双方空板 → 平局
    applyBattleResult(state, 0, 1, events);
    expect(state.players[0]!.hp).toBe(27);
    expect(state.players[1]!.hp).toBe(27);
  });

  it("胜方存活血量总和 30 → 败方扣 16（饱和曲线）", () => {
    const { state, p } = makeCtx();
    place(state, p, "lan", 1);
    const other = state.players[1]!;
    place(state, other, "lan", 1);
    // 手动构造：B 空板败北，A 存活血量 30
    const events = simulateBattle(state, 0, 1);
    const end = events[events.length - 1]!;
    if (end.type === "BATTLE_END" && end.winner === 0) {
      // 用人工事件验证公式：A 存活卡 hp 30
      const fake = {
        ...end,
        survivors: [{ player: 0, cardUid: 1, hp: 30 }],
      } as typeof end;
      applyBattleResult(state, 0, 1, [...events.slice(0, -1), fake]);
      expect(state.players[1]!.hp).toBe(30 - 16);
    }
  });

  it("血量归零出局：名次 = 当时场上存活人数", () => {
    const { state } = makeCtx();
    const events = simulateBattle(state, 0, 1); // 平局
    const end = events[events.length - 1]!;
    if (end.type === "BATTLE_END") {
      const fake = { ...end, winner: 0, survivors: [{ player: 0, cardUid: 1, hp: 200 }] } as typeof end;
      state.players[1]!.hp = 1;
      applyBattleResult(state, 0, 1, [...events.slice(0, -1), fake]);
      expect(state.players[1]!.eliminated).toBe(true);
      expect(state.players[1]!.rank).toBe(8); // 8 人都在场时第一个出局 = 第 8 名
    }
  });

  it("扣血封顶 30：200 血和 → 扣 30 而非更多", () => {
    const { state } = makeCtx();
    state.players[1]!.hp = 30;
    const events = simulateBattle(state, 0, 1);
    const end = events[events.length - 1]!;
    if (end.type === "BATTLE_END") {
      const fake = { ...end, winner: 0, survivors: [{ player: 0, cardUid: 1, hp: 1000 }] } as typeof end;
      applyBattleResult(state, 0, 1, [...events.slice(0, -1), fake]);
      expect(state.players[1]!.hp).toBe(0); // 30 - 30
    }
  });
});
