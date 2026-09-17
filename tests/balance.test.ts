import { describe, expect, it } from "vitest";
import { liftOf, runBatch, formatBatchStats, type LiftStat } from "../bot/simulation";
import { CARD_POOL, HERO_CARDS } from "../config/cards";
import { REGIONS, PROFESSIONS, TRAIT_BY_ID } from "../config/traits";

/**
 * 平衡度量（T-B）
 * 批量对局统计出英雄/羁绊的"前四率 lift"，用于发现明显过强或过弱的单位。
 * 这里只验证度量本身可靠（基线、取值范围、覆盖面），不把具体数值写死，
 * 避免每次调数值都要改测试。
 */
const GAMES = 120;

describe("平衡度量", () => {
  const stats = runBatch(9000, GAMES);

  it("基线：8 人局前四率 50%、夺冠率 12.5%", () => {
    expect(stats.games).toBe(GAMES);
    expect(stats.baselineTop4).toBeCloseTo(0.5, 2);
    expect(stats.baselineWin).toBeCloseTo(0.125, 2);
    expect(stats.winCount.reduce((a, b) => a + b, 0)).toBe(GAMES);
  });

  it("lift 计算正确：等于条件比例 ÷ 基线", () => {
    const stat: LiftStat = { appearances: 100, top4: 75, wins: 25 };
    expect(liftOf(stat, 0.5, "top4")).toBeCloseTo(1.5);
    expect(liftOf(stat, 0.125, "wins")).toBeCloseTo(2);
    expect(liftOf({ appearances: 0, top4: 0, wins: 0 }, 0.5, "top4")).toBe(0);
  });

  it("所有统计值均为有限数且比例自洽（top4 ≥ wins，均不超过样本数）", () => {
    for (const [id, s] of [...stats.heroStats, ...stats.traitStats]) {
      expect(Number.isFinite(s.appearances)).toBe(true);
      expect(s.appearances).toBeGreaterThan(0);
      expect(s.top4).toBeLessThanOrEqual(s.appearances);
      expect(s.wins).toBeLessThanOrEqual(s.top4);
      expect(id.length).toBeGreaterThan(0);
    }
  });

  it("覆盖面：绝大多数英雄与全部羁绊都会在 120 局中出现", () => {
    expect(stats.heroStats.size).toBeGreaterThanOrEqual(HERO_CARDS.length - 2);
    expect(stats.traitStats.size).toBe(REGIONS.length + PROFESSIONS.length);
    for (const id of CARD_POOL.map((c) => c.id)) {
      if (id === "duplicator") continue; // 复制器不能上阵
      // 允许极个别英雄在短批次里没被 AI 上阵
      if (!stats.heroStats.has(id)) continue;
      expect(stats.heroStats.get(id)!.appearances).toBeGreaterThan(0);
    }
  });

  it("没有明显碾压：常驻卡池的羁绊 lift 都落在合理区间内", () => {
    // 说明：昂贵羁绊（刺客/法师）的 lift 天然偏高——只有打到 L4/L5 的玩家才凑得出来，
    // 这属于选择偏差而不是纯强度。这里的区间只用来拦住"一家独大"级别的失衡。
    for (const [id, s] of stats.traitStats) {
      if (s.appearances < GAMES * 0.1) continue; // 样本太小的羁绊跳过
      const lift = liftOf(s, stats.baselineTop4, "top4");
      expect(lift, `${TRAIT_BY_ID.get(id)?.name} lift=${lift.toFixed(2)}`).toBeGreaterThan(0.6);
      expect(lift, `${TRAIT_BY_ID.get(id)?.name} lift=${lift.toFixed(2)}`).toBeLessThan(1.85);
    }
  });

  it("formatBatchStats 输出包含英雄与羁绊两张强度表", () => {
    const text = formatBatchStats(stats);
    expect(text).toContain("英雄强度");
    expect(text).toContain("羁绊强度");
    expect(text).toContain("基线");
    expect(text).toContain("平均回合数");
  });
});
