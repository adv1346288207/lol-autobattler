import { describe, expect, it } from "vitest";
import { GameSession } from "../web/session";
import { createCardInstance } from "../core/state";

describe("Web 对局会话（GameSession）", () => {
  it("构造后进入第 1 回合商店阶段，玩家 0 是人类", () => {
    const s = new GameSession(42);
    expect(s.state.phase).toBe("shop");
    expect(s.state.round).toBe(1);
    expect(s.player.isHuman).toBe(true);
    expect(s.player.shop.every((x) => x !== null)).toBe(true);
    expect(s.isOver).toBe(false);
  });

  it("act 执行玩家操作：购买入牌并返回事件", () => {
    const s = new GameSession(7);
    s.player.gold = 99;
    const idx = s.player.shop.findIndex((x) => x !== null);
    const before = s.player.hand.length;
    const events = s.act({ type: "buy", player: 0, shopIndex: idx as 0 | 1 | 2 });
    expect(s.player.hand.length).toBe(before + 1);
    expect(Array.isArray(events)).toBe(true);
  });

  it("非法操作抛错且状态不变", () => {
    const s = new GameSession(7);
    s.player.gold = 0;
    const idx = s.player.shop.findIndex((x) => x !== null);
    const snapshot = JSON.stringify(s.player);
    expect(() => s.act({ type: "buy", player: 0, shopIndex: idx as 0 | 1 | 2 })).toThrow();
    expect(JSON.stringify(s.player)).toBe(snapshot);
  });

  it("endTurn 推进回合：返回战斗日志并进入下一回合", () => {
    const s = new GameSession(7);
    const events = s.endTurn();
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === "BATTLE_END")).toBe(true);
    expect(s.battleLog).toBe(events);
    if (!s.isOver) {
      expect(s.state.phase).toBe("shop");
      expect(s.state.round).toBe(2);
    }
  });

  it("整局可玩完（人类只按结束回合）：名次完整", () => {
    const s = new GameSession(7);
    let guard = 0;
    while (!s.isOver && guard++ < 100) {
      s.endTurn();
    }
    expect(s.isOver).toBe(true);
    const ranks = s.state.players.map((p) => p.rank);
    expect(ranks.every((r) => r !== null)).toBe(true);
    expect(new Set(ranks).size).toBe(8);
    expect(s.finalRanking()[0]!.rank).toBe(1);
  });

  it("确定性：同 seed 两局同操作序列 → 相同结果", () => {
    const a = new GameSession(123);
    const b = new GameSession(123);
    const run = (s: GameSession) => {
      let guard = 0;
      while (!s.isOver && guard++ < 100) s.endTurn();
      return JSON.stringify(s.state.players.map((p) => ({ hp: p.hp, rank: p.rank })));
    };
    expect(run(a)).toBe(run(b));
  });

  it("金卡合成：买 3 张同卡 → 金卡进手牌（数值为三张之和）", () => {
    const s = new GameSession(7);
    // 直接塞 3 张兰进手牌，验证 endShop 兜底合并
    for (let i = 0; i < 3; i++) s.player.hand.push(createCardInstance(s.state, "lan"));
    s.act({ type: "endShop", player: 0 });
    expect(s.player.hand).toHaveLength(1);
    const gold = s.player.hand[0]!;
    expect(gold.level).toBe(2);
    expect(gold.atk).toBe(6);
    expect(gold.hp).toBe(6);
  });
});
