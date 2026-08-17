import { describe, expect, it } from "vitest";
import { createRng, pick, pickWeighted, randInt } from "../core/rng";

describe("RNG 确定性（地基原则 2.1）", () => {
  it("同一 seed 产生完全相同序列", () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 100; i++) {
      expect(a()).toBe(b());
    }
  });

  it("不同 seed 产生不同序列", () => {
    const a = createRng(1);
    const b = createRng(2);
    let same = 0;
    for (let i = 0; i < 10; i++) {
      if (a() === b()) same++;
    }
    expect(same).toBeLessThan(10);
  });

  it("randInt 始终落在 [min, max] 区间", () => {
    const rng = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = randInt(rng, 3, 9);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(9);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it("pick 从数组中取元素，空数组抛错", () => {
    const rng = createRng(11);
    const arr = ["a", "b", "c"];
    for (let i = 0; i < 100; i++) {
      expect(arr).toContain(pick(rng, arr));
    }
    expect(() => pick(rng, [])).toThrow();
  });

  it("pickWeighted 只返回权重表里的 key", () => {
    const rng = createRng(99);
    const weights = { green: 70, blue: 20, orange: 10 };
    for (let i = 0; i < 1000; i++) {
      expect(["green", "blue", "orange"]).toContain(pickWeighted(rng, weights));
    }
  });
});
