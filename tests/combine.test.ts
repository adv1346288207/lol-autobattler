import { describe, expect, it } from "vitest";
import { makeCtx, giveHand, place, handOf } from "./helpers";
import { runCombineChecks } from "../core/combine";
import { createCardInstance } from "../core/state";

describe("三合一（用户实测口径）", () => {
  it("2 张不合成", () => {
    const { state, p } = makeCtx();
    giveHand(state, p, "lan");
    giveHand(state, p, "lan");
    const events = runCombineChecks(state, p);
    expect(events).toEqual([]);
    expect(p.hand).toHaveLength(2);
  });

  it("仓库 3 张真卡 → 合成金卡进手牌", () => {
    const { state, p } = makeCtx();
    giveHand(state, p, "lan");
    giveHand(state, p, "lan");
    giveHand(state, p, "lan");
    const events = runCombineChecks(state, p);
    expect(events).toHaveLength(1);
    expect(p.hand).toHaveLength(1);
    const gold = p.hand[0]!;
    expect(gold.level).toBe(2);
    expect(gold.atk).toBe(6); // 2+2+2
    expect(gold.hp).toBe(6); // 2+2+2
    expect(gold.position).toBeNull();
  });

  it("金卡属性 = 三张之和（洛伊 1/5 ×3 → 3/15）", () => {
    const { state, p } = makeCtx();
    giveHand(state, p, "loey");
    giveHand(state, p, "loey");
    giveHand(state, p, "loey");
    runCombineChecks(state, p);
    const gold = p.hand[0]!;
    expect(gold.atk).toBe(3);
    expect(gold.hp).toBe(15);
  });

  it("1 号位 + 仓库 + 分裂者 → 合成，金卡留在 1 号位", () => {
    const { state, p } = makeCtx();
    place(state, p, "lan", 1);
    giveHand(state, p, "lan");
    giveHand(state, p, "fenliezhe");
    const events = runCombineChecks(state, p);
    expect(events).toHaveLength(1);
    const gold = p.board[0]!;
    expect(gold.level).toBe(2);
    expect(gold.configId).toBe("lan");
    expect(p.hand).toHaveLength(0); // 仓库兰 + 分裂者都被消耗
  });

  it("扫描优先级：1 号位兰优先于 2 号位龙野", () => {
    const { state, p } = makeCtx();
    place(state, p, "lan", 1);
    place(state, p, "longye", 2);
    giveHand(state, p, "lan");
    giveHand(state, p, "longye");
    giveHand(state, p, "fenliezhe");
    const events = runCombineChecks(state, p);
    expect(events).toHaveLength(1);
    expect(p.board[0]!.configId).toBe("lan");
    expect(p.board[0]!.level).toBe(2);
    // 龙野未合成：2 号位龙野 + 仓库龙野还在（分裂者已被兰消耗）
    expect(p.board[1]!.configId).toBe("longye");
    expect(p.board[1]!.level).toBe(1);
    expect(handOf(p, "longye")).toHaveLength(1);
    expect(handOf(p, "fenliezhe")).toHaveLength(0);
  });

  it("3 张真卡全在场上（1/3/6 号位）→ 金卡留 1 号位，其余空出", () => {
    const { state, p } = makeCtx();
    place(state, p, "lan", 1);
    place(state, p, "lan", 3);
    place(state, p, "lan", 6);
    runCombineChecks(state, p);
    expect(p.board[0]!.level).toBe(2);
    expect(p.board[2]).toBeNull();
    expect(p.board[5]).toBeNull();
    expect(p.hand).toHaveLength(0);
  });

  it("2 个位置持有同卡 + 分裂者 → 不合并（双持有不补齐）", () => {
    const { state, p } = makeCtx();
    place(state, p, "lan", 1);
    place(state, p, "lan", 3);
    giveHand(state, p, "fenliezhe");
    const events = runCombineChecks(state, p);
    expect(events).toEqual([]);
    expect(p.board[0]!.level).toBe(1);
    expect(p.board[2]!.level).toBe(1);
    expect(handOf(p, "fenliezhe")).toHaveLength(1);
  });

  it("2 个位置持有 + 仓库 1 张 = 3 张真卡 → 合并，金卡留第一位置", () => {
    const { state, p } = makeCtx();
    place(state, p, "lan", 1);
    place(state, p, "lan", 3);
    giveHand(state, p, "lan");
    runCombineChecks(state, p);
    expect(p.board[0]!.level).toBe(2);
    expect(p.board[2]).toBeNull();
    expect(p.hand).toHaveLength(0);
  });

  it("金卡（level 2）不可再合成", () => {
    const { state, p } = makeCtx();
    const gold = createCardInstance(state, "lan", 2);
    gold.atk = 6;
    gold.hp = 6;
    gold.position = 1;
    p.board[0] = gold;
    giveHand(state, p, "lan");
    giveHand(state, p, "lan");
    giveHand(state, p, "lan");
    // 仓库 3 张自己合成，不与场上金卡合并
    runCombineChecks(state, p);
    expect(p.board[0]!.level).toBe(2);
    expect(p.hand).toHaveLength(1);
    expect(p.hand[0]!.level).toBe(2);
  });

  it("3 张分裂者不合成", () => {
    const { state, p } = makeCtx();
    giveHand(state, p, "fenliezhe");
    giveHand(state, p, "fenliezhe");
    giveHand(state, p, "fenliezhe");
    const events = runCombineChecks(state, p);
    expect(events).toEqual([]);
    expect(p.hand).toHaveLength(3);
  });

  it("合并后金卡攻击/血量包含分裂者自身数值", () => {
    const { state, p } = makeCtx();
    const f = createCardInstance(state, "fenliezhe");
    f.atk = 3; // 模拟用户提供的分裂者数值
    f.hp = 5;
    p.hand.push(f);
    place(state, p, "lan", 1);
    giveHand(state, p, "lan");
    runCombineChecks(state, p);
    const gold = p.board[0]!;
    expect(gold.atk).toBe(2 + 2 + 3);
    expect(gold.hp).toBe(2 + 2 + 5);
  });
});
