import { describe, expect, it } from "vitest";
import { makeCtx, giveHand, place, handOf } from "./helpers";
import { beginRound } from "../core/phase";
import { applyAction } from "../core/actions";
import { rollShop } from "../core/shop";
import { CARD_BY_ID, CARD_POOL } from "../config/cards";
import { shopConfig } from "../config/shop";

describe("购买", () => {
  it("成功购买：扣金、入手牌、槽位清空", () => {
    const { state, rng, p } = makeCtx();
    beginRound(state, rng);
    p.gold = 99; // R1 只有 2 金，可能买不起随机刷出的 4 金卡
    const idx = p.shop.findIndex((s) => s !== null);
    const configId = p.shop[idx]!;
    const price = CARD_BY_ID.get(configId)!.price;
    const goldBefore = p.gold;
    const events = applyAction(state, rng, { type: "buy", player: 0, shopIndex: idx as 0 | 1 | 2 });
    expect(p.gold).toBe(goldBefore - price);
    expect(p.hand).toHaveLength(1);
    expect(p.hand[0]!.configId).toBe(configId);
    expect(p.shop[idx]).toBeNull();
    expect(events).toEqual([]); // 单张无合成
  });

  it("金币不足抛错且状态不变", () => {
    const { state, rng, p } = makeCtx();
    beginRound(state, rng);
    p.gold = 0;
    const idx = p.shop.findIndex((s) => s !== null);
    const snapshot = JSON.stringify(p);
    expect(() => applyAction(state, rng, { type: "buy", player: 0, shopIndex: idx as 0 | 1 | 2 })).toThrow();
    expect(JSON.stringify(p)).toBe(snapshot);
  });

  it("空槽位购买抛错", () => {
    const { state, rng } = makeCtx();
    const idx = p0ShopNullIdx(state);
    expect(() => applyAction(state, rng, { type: "buy", player: 0, shopIndex: idx as 0 | 1 | 2 })).toThrow();
  });

  it("手牌满 15 拒绝购买", () => {
    const { state, rng, p } = makeCtx();
    beginRound(state, rng);
    p.gold = 99;
    for (let i = 0; i < shopConfig.handLimit; i++) giveHand(state, p, "loey");
    const idx = p.shop.findIndex((s) => s !== null);
    expect(() => applyAction(state, rng, { type: "buy", player: 0, shopIndex: idx as 0 | 1 | 2 })).toThrow();
    expect(p.hand).toHaveLength(15);
  });
});

function p0ShopNullIdx(state: ReturnType<typeof makeCtx>["state"]): number {
  return state.players[0]!.shop.findIndex((s) => s === null);
}

describe("刷新", () => {
  it("1 金刷新；免费刷新优先且不扣金", () => {
    const { state, rng, p } = makeCtx();
    beginRound(state, rng);
    const goldBefore = p.gold;
    applyAction(state, rng, { type: "refresh", player: 0 });
    expect(p.gold).toBe(goldBefore - shopConfig.refreshCost);
    expect(p.shop.every((s) => s !== null)).toBe(true);

    p.freeRefresh = 1;
    const g2 = p.gold;
    applyAction(state, rng, { type: "refresh", player: 0 });
    expect(p.gold).toBe(g2); // 不扣金
    expect(p.freeRefresh).toBe(0);
  });

  it("金币不足刷新抛错", () => {
    const { state, rng, p } = makeCtx();
    beginRound(state, rng);
    p.gold = 0;
    p.freeRefresh = 0;
    const before = p.shop.slice();
    expect(() => applyAction(state, rng, { type: "refresh", player: 0 })).toThrow();
    expect(p.shop).toEqual(before);
  });

  it("1 级商店永远不会刷出橙卡（用户确认 L1~L3 橙=0）", () => {
    const { state, rng, p } = makeCtx();
    p.shopLevel = 1;
    for (let i = 0; i < 2000; i++) {
      rollShop(state, rng, p);
      for (const id of p.shop) {
        expect(CARD_BY_ID.get(id!)!.quality).not.toBe("orange");
      }
    }
  });

  it("刷出的卡都在卡池里", () => {
    const { state, rng, p } = makeCtx();
    for (let level = 1; level <= 5; level++) {
      p.shopLevel = level;
      for (let i = 0; i < 100; i++) {
        rollShop(state, rng, p);
        for (const id of p.shop) {
          expect(CARD_POOL.some((c) => c.id === id)).toBe(true);
        }
      }
    }
  });
});

describe("出售", () => {
  it("手牌出售返还买入价", () => {
    const { state, rng, p } = makeCtx();
    const card = giveHand(state, p, "lan");
    p.gold = 0;
    applyAction(state, rng, { type: "sell", player: 0, cardUid: card.uid });
    expect(p.gold).toBe(CARD_BY_ID.get("lan")!.price);
    expect(p.hand).toHaveLength(0);
  });

  it("场上卡出售后位置清空", () => {
    const { state, rng, p } = makeCtx();
    const card = place(state, p, "swat", 1);
    p.gold = 0;
    applyAction(state, rng, { type: "sell", player: 0, cardUid: card.uid });
    expect(p.board[0]).toBeNull();
    expect(p.gold).toBe(1);
  });

  it("不存在的 uid 抛错", () => {
    const { state, rng } = makeCtx();
    expect(() => applyAction(state, rng, { type: "sell", player: 0, cardUid: 99999 })).toThrow();
  });
});

describe("移动", () => {
  it("手牌 → 空位", () => {
    const { state, rng, p } = makeCtx();
    const card = giveHand(state, p, "lan");
    applyAction(state, rng, { type: "move", player: 0, cardUid: card.uid, position: 3 });
    expect(p.board[2]!.uid).toBe(card.uid);
    expect(p.board[2]!.position).toBe(3);
    expect(p.hand).toHaveLength(0);
  });

  it("手牌 → 已占位：交换（原位卡回手牌）", () => {
    const { state, rng, p } = makeCtx();
    const onBoard = place(state, p, "swat", 1);
    const inHand = giveHand(state, p, "lan");
    applyAction(state, rng, { type: "move", player: 0, cardUid: inHand.uid, position: 1 });
    expect(p.board[0]!.uid).toBe(inHand.uid);
    expect(handOf(p, "swat")).toHaveLength(1); // 斯沃特回手牌
    expect(p.board[0]!.position).toBe(1);
    void onBoard;
  });

  it("场上 → 场上：交换位置", () => {
    const { state, rng, p } = makeCtx();
    const a = place(state, p, "lan", 1);
    const b = place(state, p, "swat", 4);
    applyAction(state, rng, { type: "move", player: 0, cardUid: a.uid, position: 4 });
    expect(p.board[3]!.uid).toBe(a.uid);
    expect(p.board[0]!.uid).toBe(b.uid);
    expect(p.board[0]!.position).toBe(1);
    expect(p.board[3]!.position).toBe(4);
  });

  it("场上卡 → position 0 回手牌", () => {
    const { state, rng, p } = makeCtx();
    const card = place(state, p, "lan", 2);
    applyAction(state, rng, { type: "move", player: 0, cardUid: card.uid, position: 0 });
    expect(p.board[1]).toBeNull();
    expect(p.hand).toHaveLength(1);
    expect(p.hand[0]!.uid).toBe(card.uid);
    expect(p.hand[0]!.position).toBeNull();
  });

  it("手牌卡执行 position 0 抛错", () => {
    const { state, rng, p } = makeCtx();
    const card = giveHand(state, p, "lan");
    expect(() => applyAction(state, rng, { type: "move", player: 0, cardUid: card.uid, position: 0 })).toThrow();
    expect(p.hand).toHaveLength(1);
  });

  it("非法位置抛错", () => {
    const { state, rng, p } = makeCtx();
    const card = giveHand(state, p, "lan");
    expect(() => applyAction(state, rng, { type: "move", player: 0, cardUid: card.uid, position: 7 })).toThrow();
    expect(() => applyAction(state, rng, { type: "move", player: 0, cardUid: card.uid, position: -1 })).toThrow();
  });
});
