import { describe, expect, it } from "vitest";
import { createGame, type GameState } from "../core/state";
import { createRng } from "../core/rng";
import { beginRound, resolveRound } from "../core/phase";
import { runAutoGame, runBatch } from "../bot/simulation";

/** 全 AI 完整跑一局 */
function runFullGame(seed: number): GameState {
  return runAutoGame(seed);
}

describe("全流程（7 AI 完整对局）", () => {
  it("1000 局全部正常终止：名次完整、血量合法、性能达标", () => {
    const t0 = Date.now();
    for (let seed = 1; seed <= 1000; seed++) {
      const state = runFullGame(seed);
      // 名次：8 人各一个名次 1~8
      const ranks = state.players.map((p) => p.rank);
      expect(ranks.every((r) => r !== null)).toBe(true);
      expect(new Set(ranks).size).toBe(8);
      // 第 1 名是最后存活者
      const winner = state.players.find((p) => p.rank === 1)!;
      expect(winner.eliminated).toBe(false);
      // 血量合法、回合数在保护内
      for (const p of state.players) {
        expect(p.hp).toBeGreaterThanOrEqual(0);
        expect(p.hp).toBeLessThanOrEqual(30);
      }
      expect(state.round).toBeLessThanOrEqual(60);
    }
    const elapsed = Date.now() - t0;
    const avgMs = elapsed / 1000;
    // eslint-disable-next-line no-console
    console.log(`[性能] 1000 局耗时 ${elapsed}ms，平均 ${avgMs.toFixed(2)}ms/局`);
    expect(avgMs).toBeLessThan(100); // 验收标准：单局模拟 < 100ms
  });

  it("确定性：同 seed 两次结果完全一致（T2 首验）", () => {
    const a = runFullGame(777);
    const b = runFullGame(777);
    const summary = (s: GameState) => JSON.stringify({
      ranks: s.players.map((p) => p.rank),
      hp: s.players.map((p) => p.hp),
      round: s.round,
      battleLogLen: s.battleLog.length,
    });
    expect(summary(a)).toBe(summary(b));
  });

  it("批量统计：runBatch 汇总夺冠次数与局数一致", () => {
    const stats = runBatch(3000, 50);
    expect(stats.games).toBe(50);
    const totalWins = stats.winCount.reduce((a, b) => a + b, 0);
    expect(totalWins).toBe(50);
    expect(stats.totalRounds).toBeGreaterThan(0);
  });

  it("全空板局：四场平局，人人扣 3", () => {
    const state = createGame(1);
    const rng = createRng(1);
    beginRound(state, rng);
    // 清零金币/经验，隔离 R2 收入断言
    for (const p of state.players) {
      p.gold = 0;
      p.exp = 0;
      p.shopDone = true;
    }
    resolveRound(state, rng);
    expect(state.round).toBe(2);
    expect(state.phase).toBe("shop");
    for (const p of state.players) {
      expect(p.hp).toBe(27); // 30 - 3 平局
      expect(p.gold).toBe(3); // R2 收入
      expect(p.exp).toBe(1);
    }
  });
});
