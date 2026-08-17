import { describe, expect, it } from "vitest";
import { makeCtx } from "./helpers";
import { beginRound, resolveRound } from "../core/phase";
import { applyAction, type Action } from "../core/actions";
import { createRng, pick, randInt, type Rng } from "../core/rng";
import type { GameState } from "../core/state";

/** 生成随机（可能非法的）Action */
function randomAction(state: GameState, rng: Rng): Action {
  const p = state.players[0]!;
  const allCards = [...p.hand, ...p.board.filter((c): c is NonNullable<typeof c> => c !== null)];
  const randomUid = allCards.length > 0 ? pick(rng, allCards).uid : 0;
  const t = randInt(rng, 0, 5);
  switch (t) {
    case 0:
      return { type: "buy", player: 0, shopIndex: randInt(rng, 0, 2) as 0 | 1 | 2 };
    case 1:
      return { type: "sell", player: 0, cardUid: randomUid };
    case 2:
      return { type: "refresh", player: 0 };
    case 3:
      return { type: "upgradeShop", player: 0 };
    case 4:
      return { type: "move", player: 0, cardUid: randomUid, position: randInt(rng, 0, 7) };
    default:
      return { type: "endShop", player: 0 };
  }
}

function assertInvariants(state: GameState): void {
  for (const p of state.players) {
    expect(p.hp).toBeGreaterThanOrEqual(0);
    expect(p.hp).toBeLessThanOrEqual(30);
    expect(p.gold).toBeGreaterThanOrEqual(0);
    expect(p.exp).toBeGreaterThanOrEqual(0);
    expect(p.shopLevel).toBeGreaterThanOrEqual(1);
    expect(p.shopLevel).toBeLessThanOrEqual(5);
    expect(p.hand.length).toBeLessThanOrEqual(15);
    expect(p.board).toHaveLength(6);
    const cards = [...p.hand, ...p.board.filter((x): x is NonNullable<typeof x> => x !== null)];
    expect(cards.length).toBeLessThanOrEqual(15 + 6);
    for (const c of cards) {
      expect([1, 2]).toContain(c.level);
      expect(c.hp).toBeGreaterThanOrEqual(0);
      expect(c.atk).toBeGreaterThanOrEqual(0);
    }
  }
}

describe("不变量 fuzz（T3）", () => {
  it("1 万条随机 Action：零崩溃、不变量恒成立、非法操作零污染", () => {
    const { state, rng } = makeCtx(2024);
    beginRound(state, rng);
    let ok = 0;
    let rejected = 0;
    for (let i = 0; i < 10000; i++) {
      const action = randomAction(state, rng);
      const snapshot = JSON.stringify(state.players);
      try {
        applyAction(state, rng, action);
        ok++;
      } catch {
        rejected++;
        // 非法操作零污染：状态与操作前完全一致
        expect(JSON.stringify(state.players)).toBe(snapshot);
      }
      if (i % 500 === 0) assertInvariants(state);
    }
    assertInvariants(state);
    expect(ok).toBeGreaterThan(0);
    expect(rejected).toBeGreaterThan(0); // 合法与非法两条路径都被覆盖
  });

  it("随机操作序列 + 强制回合推进：任意时刻不变量成立", () => {
    const { state, rng } = makeCtx(555);
    beginRound(state, rng);
    const chaos = createRng(999);
    let guard = 0;
    while (state.phase !== "ended" && guard++ < 1000) {
      if (state.phase === "shop") {
        // 玩家 0 随机行动 20 次（可能非法，被拒后状态不变）
        for (let i = 0; i < 20; i++) {
          try {
            applyAction(state, rng, randomAction(state, chaos));
          } catch {
            /* 预期：非法操作被拒 */
          }
          assertInvariants(state);
        }
        // 强制全员结束 → 推进回合
        for (const p of state.players) {
          if (!p.eliminated && !p.shopDone) {
            applyAction(state, rng, { type: "endShop", player: p.id });
          }
        }
      }
      resolveRound(state, rng);
      assertInvariants(state);
    }
    expect(state.phase).toBe("ended");
  });
});
