import { describe, expect, it } from "vitest";
import { makeCtx } from "./helpers";
import { pairPlayers } from "../core/matchmaking";

describe("配对", () => {
  it("8 人 → 4 对、无人重复、无轮空", () => {
    const { state, rng } = makeCtx(42);
    const pairs = pairPlayers(state, rng);
    expect(pairs).toHaveLength(4);
    const seen = new Set<number>();
    for (const { a, b } of pairs) {
      expect(b).not.toBeNull();
      expect(seen.has(a)).toBe(false);
      seen.add(a);
      if (b !== null) {
        expect(seen.has(b)).toBe(false);
        seen.add(b);
      }
    }
    expect(seen.size).toBe(8);
  });

  it("7 人 → 3 对 + 1 轮空", () => {
    const { state, rng } = makeCtx(7);
    state.players[7]!.eliminated = true;
    const pairs = pairPlayers(state, rng);
    expect(pairs).toHaveLength(4);
    const byes = pairs.filter((p) => p.b === null);
    expect(byes).toHaveLength(1);
    const seen = new Set<number>();
    for (const { a, b } of pairs) {
      seen.add(a);
      if (b !== null) seen.add(b);
    }
    expect(seen.size).toBe(7);
  });

  it("连续回合不与上回合对手重复（50 个 seed）", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const { state, rng } = makeCtx(seed);
      const round1 = pairPlayers(state, rng);
      const round2 = pairPlayers(state, rng);
      const r1Map = new Map<number, number>();
      for (const { a, b } of round1) {
        if (b !== null) {
          r1Map.set(a, b);
          r1Map.set(b, a);
        }
      }
      for (const { a, b } of round2) {
        if (b !== null) {
          expect(r1Map.get(a)).not.toBe(b);
          expect(r1Map.get(b)).not.toBe(a);
        }
      }
    }
  });

  it("仅剩 2 人时允许重复配对（按集合比较，shuffle 可能换序）", () => {
    const { state, rng } = makeCtx();
    for (let i = 2; i < 8; i++) state.players[i]!.eliminated = true;
    const r1 = pairPlayers(state, rng);
    const r2 = pairPlayers(state, rng);
    const s1 = [r1[0]!.a, r1[0]!.b].sort();
    const s2 = [r2[0]!.a, r2[0]!.b].sort();
    expect(s1).toEqual(s2);
  });
});
