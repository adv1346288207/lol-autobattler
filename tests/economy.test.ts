import { describe, expect, it } from "vitest";
import { makeCtx, place } from "./helpers";
import { beginRound } from "../core/phase";
import { upgradeShopAction } from "../core/economy";
import { createCardInstance } from "../core/state";

describe("回合收入（金币阶梯 + 自动经验）", () => {
  it("R1：金币 2、经验 1、商店自动刷 3 张", () => {
    const { state, rng, p } = makeCtx();
    beginRound(state, rng);
    expect(p.gold).toBe(2);
    expect(p.exp).toBe(1);
    expect(p.shop).toHaveLength(3);
    expect(p.shop.every((s) => s !== null)).toBe(true);
  });

  it("R10：金币 11；R11：金币 13；R15 起：20 封顶", () => {
    const { state, rng, p } = makeCtx();
    for (let r = 1; r <= 10; r++) {
      state.round = r;
      p.gold = 0;
      p.exp = 0;
      beginRound(state, rng);
      if (r === 10) expect(p.gold).toBe(11);
    }
    state.round = 11;
    p.gold = 0;
    beginRound(state, rng);
    expect(p.gold).toBe(13);
    state.round = 15;
    p.gold = 0;
    beginRound(state, rng);
    expect(p.gold).toBe(20);
    state.round = 30;
    p.gold = 0;
    beginRound(state, rng);
    expect(p.gold).toBe(20);
  });

  it("场上兰：额外 +1 经验；金兰：额外 +2 经验", () => {
    const { state, rng, p } = makeCtx();
    place(state, p, "lan", 1);
    beginRound(state, rng);
    expect(p.exp).toBe(2); // 基础 1 + 兰 1

    const { state: s2, rng: r2, p: p2 } = makeCtx();
    const goldLan = createCardInstance(s2, "lan", 2);
    goldLan.atk = 6;
    goldLan.hp = 6;
    goldLan.position = 1;
    p2.board[0] = goldLan;
    beginRound(s2, r2);
    expect(p2.exp).toBe(3); // 基础 1 + 金兰 2
  });

  it("龙野：每回合 1 次免费刷新；免费刷新不累积", () => {
    const { state, rng, p } = makeCtx();
    place(state, p, "longye", 1);
    beginRound(state, rng);
    expect(p.freeRefresh).toBe(1);
    // 本回合没用掉，下回合清零后重新 +1（不累积）
    beginRound(state, rng);
    expect(p.freeRefresh).toBe(1);
  });

  it("金龙野：每回合 2 次免费刷新", () => {
    const { state, rng, p } = makeCtx();
    const goldLongye = createCardInstance(state, "longye", 2);
    goldLongye.atk = 6;
    goldLongye.hp = 9;
    goldLongye.position = 1;
    p.board[0] = goldLongye;
    beginRound(state, rng);
    expect(p.freeRefresh).toBe(2);
  });
});

describe("升级商店（金币一次性补经验差，2026-08-17 机制）", () => {
  it("差 2 经验 → 付 2 金币升级（1→2 需 2 经验）", () => {
    const { p } = makeCtx();
    p.gold = 5;
    p.exp = 0;
    upgradeShopAction(p);
    expect(p.shopLevel).toBe(2);
    expect(p.gold).toBe(3); // 一次性补 2 金
    expect(p.exp).toBe(0);
  });

  it("已有 1 经验 → 只补 1 金币", () => {
    const { p } = makeCtx();
    p.gold = 5;
    p.exp = 1;
    upgradeShopAction(p);
    expect(p.shopLevel).toBe(2);
    expect(p.gold).toBe(4);
    expect(p.exp).toBe(0);
  });

  it("经验 ≥ 所需 → 免费升级，多余经验保留", () => {
    const { p } = makeCtx();
    p.gold = 0;
    p.exp = 5; // 1→2 需 2，剩余 3
    upgradeShopAction(p);
    expect(p.shopLevel).toBe(2);
    expect(p.gold).toBe(0);
    expect(p.exp).toBe(3);
  });

  it("2→3 需 8 经验：差 8 经验 → 付 8 金币（用户举例）", () => {
    const { p } = makeCtx();
    p.shopLevel = 2;
    p.gold = 10;
    p.exp = 0;
    upgradeShopAction(p);
    expect(p.shopLevel).toBe(3);
    expect(p.gold).toBe(2);
  });

  it("金币不足以补差 → 抛错且状态不变", () => {
    const { p } = makeCtx();
    p.gold = 1;
    p.exp = 0; // 差 2 金
    const snapshot = JSON.stringify(p);
    expect(() => upgradeShopAction(p)).toThrow();
    expect(JSON.stringify(p)).toBe(snapshot);
  });

  it("5 级满级后升级抛错", () => {
    const { p } = makeCtx();
    p.shopLevel = 5;
    p.exp = 99;
    p.gold = 99;
    expect(() => upgradeShopAction(p)).toThrow();
  });
});
