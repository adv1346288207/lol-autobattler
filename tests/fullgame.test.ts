import { describe, expect, it } from "vitest";
import { createGame, type BattleEvent, type GameState } from "../core/state";
import { createRng } from "../core/rng";
import { beginRound, resolveRound } from "../core/phase";
import { runAutoGame, runBatch } from "../bot/simulation";
import { runBotTurn, createBot } from "../bot/random";

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
    const state = createGame(1, null, { startingLoadout: false });
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

  it("战斗日志健康检查：无 NaN、无负护盾、法力不越界、每场都有结束事件（30 局逐回合）", () => {
    let battlesChecked = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const state = createGame(seed);
      const rng = createRng(seed);
      const bots = new Map(state.players.map((p) => [p.id, createBot(seed, p.id)]));
      beginRound(state, rng);
      let guard = 0;
      while (state.phase !== "ended" && guard++ < 100) {
        for (const p of [...state.players]) {
          if (!p.eliminated && !p.shopDone) runBotTurn(state, rng, p.id, bots.get(p.id)!);
        }
        const log = resolveRound(state, rng);
        checkBattleLog(log);
        battlesChecked += log.filter((e) => e.type === "BATTLE_START").length;
      }
      expect(state.phase).toBe("ended");
    }
    expect(battlesChecked).toBeGreaterThan(300);
  });

  function checkBattleLog(log: BattleEvent[]): void {
    const maxMana = new Map<number, number>();
    const deaths = new Map<number, number>();
    let starts = 0;
    let ends = 0;
    for (const e of log) {
      switch (e.type) {
        case "BATTLE_START":
          starts += 1;
          for (const snap of [...e.boards.a, ...e.boards.b]) {
            maxMana.set(snap.uid, snap.maxMana);
            expect(Number.isFinite(snap.hp)).toBe(true);
            expect(snap.hp).toBeGreaterThanOrEqual(0);
            expect(snap.maxHp).toBeGreaterThan(0);
            expect(snap.shield).toBeGreaterThanOrEqual(0);
            expect(snap.mana).toBeGreaterThanOrEqual(0);
            expect(snap.mana).toBeLessThanOrEqual(snap.maxMana);
          }
          break;
        case "DAMAGE":
          expect(Number.isFinite(e.amount)).toBe(true);
          expect(e.amount).toBeGreaterThanOrEqual(0);
          expect(e.absorbed).toBeGreaterThanOrEqual(0);
          expect(e.absorbed).toBeLessThanOrEqual(e.amount);
          expect(e.remainingHp).toBeGreaterThanOrEqual(0);
          break;
        case "SHIELD_GAIN":
          expect(e.amount).toBeGreaterThanOrEqual(0);
          expect(e.totalShield).toBeGreaterThanOrEqual(0);
          break;
        case "SHIELD_BREAK":
          expect(e.amount).toBeGreaterThanOrEqual(0);
          break;
        case "HEAL":
          expect(e.amount).toBeGreaterThanOrEqual(0);
          expect(e.remainingHp).toBeGreaterThanOrEqual(0);
          break;
        case "MANA_CHANGE": {
          expect(Number.isFinite(e.after)).toBe(true);
          expect(e.after).toBeGreaterThanOrEqual(0);
          const cap = maxMana.get(e.who);
          if (cap !== undefined && !e.reason.startsWith("cast")) {
            expect(e.after).toBeLessThanOrEqual(cap);
          }
          break;
        }
        case "DEATH":
          deaths.set(e.who, (deaths.get(e.who) ?? 0) + 1);
          break;
        case "BATTLE_END":
          ends += 1;
          break;
        default:
          break;
      }
    }
    // 死亡只触发一次
    for (const n of deaths.values()) expect(n).toBe(1);
    // 每场战斗都正常收尾（无无限战斗）
    expect(ends).toBe(starts);
  }
});
