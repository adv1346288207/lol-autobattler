import { describe, expect, it } from "vitest";
import { makeCtx, giveHand, place } from "./helpers";
import { cardLabel, renderHumanSummary, renderShop } from "../cli/render";
import { beginRound } from "../core/phase";

describe("文本渲染", () => {
  it("卡牌标签含品质与金卡标记", () => {
    const { state, p } = makeCtx();
    const c = place(state, p, "lan", 1);
    expect(cardLabel(c)).toContain("兰");
    expect(cardLabel(c)).toContain("蓝");
    expect(cardLabel(c)).toContain("2攻/2血");
    const gold = giveHand(state, p, "loey");
    gold.level = 2;
    gold.atk = 3;
    gold.hp = 15;
    expect(cardLabel(gold)).toContain("★金");
    expect(cardLabel(gold)).toContain("3攻/15血");
  });

  it("商店渲染包含价格与槽位号", () => {
    const { state, rng, p } = makeCtx();
    beginRound(state, rng);
    const text = renderShop(p);
    expect(text).toContain("商店Lv1");
    expect(text).toContain("金币 2");
    expect(text).toContain("[0]");
    expect(text).toContain("[1]");
    expect(text).toContain("[2]");
    expect(text).toContain("棋盘:");
    expect(text).toContain("1前");
    expect(text).toContain("4后");
  });

  it("总览渲染包含计分板与棋盘", () => {
    const { state, rng } = makeCtx();
    beginRound(state, rng);
    const text = renderHumanSummary(state);
    expect(text).toContain("第 1 回合");
    expect(text).toContain("玩家0（你）");
    expect(text).toContain("血量 30/30");
    expect(text).toContain("手牌:");
  });
});
