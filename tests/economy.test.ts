import { describe, expect, it } from "vitest";
import { makeCtx, place } from "./helpers";
import { beginRound } from "../core/phase";
import { buyExpAction, upgradeShopAction } from "../core/economy";
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

describe("买经验 / 升级商店", () => {
  it("2 金 = 1 经验；金币不足抛错", () => {
    const { p } = makeCtx();
    p.gold = 5;
    buyExpAction(p);
    expect(p.gold).toBe(3);
    expect(p.exp).toBe(1);
    p.gold = 1;
    expect(() => buyExpAction(p)).toThrow();
    expect(p.exp).toBe(1); // 状态未污染
  });

  it("升级消耗：1→2 需 2 经验；经验不足抛错", () => {
    const { p } = makeCtx();
    p.exp = 2;
    upgradeShopAction(p);
    expect(p.shopLevel).toBe(2);
    expect(p.exp).toBe(0);
    p.exp = 3;
    expect(() => upgradeShopAction(p)).toThrow(); // 2→3 需 4
    expect(p.shopLevel).toBe(2);
  });

  it("5 级满级后升级抛错", () => {
    const { p } = makeCtx();
    p.shopLevel = 5;
    p.exp = 99;
    expect(() => upgradeShopAction(p)).toThrow();
  });
});
