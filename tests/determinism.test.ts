import { describe, expect, it } from "vitest";
import { createGame, type GameState } from "../core/state";
import { createRng } from "../core/rng";
import { beginRound, resolveRound } from "../core/phase";
import { applyAction, type Action } from "../core/actions";
import { createBot } from "../bot/random";

/**
 * 带 Action 日志的完整对局运行器（T5 回放的基础）
 * AI 使用独立随机源 → 回放时无需调用 AI 决策，日志原样重放即可
 */
function runFullGameLogged(seed: number): { state: GameState; log: Action[] } {
  const state = createGame(seed);
  const rng = createRng(seed);
  const bots = new Map(state.players.map((p) => [p.id, createBot(seed, p.id)]));
  const log: Action[] = [];
  beginRound(state, rng);
  let guard = 0;
  while (state.phase !== "ended" && guard++ < 200) {
    for (const p of [...state.players]) {
      while (!p.eliminated && !p.shopDone) {
        const a = bots.get(p.id)!.decide(state, p.id);
        applyAction(state, rng, a);
        log.push(a);
      }
    }
    resolveRound(state, rng);
  }
  if (state.phase !== "ended") throw new Error("对局未在保护次数内结束");
  return { state, log };
}

/** 按 Action 日志重放（不依赖 AI 决策，仅重放操作序列） */
function replayFromLog(seed: number, log: Action[]): GameState {
  const state = createGame(seed);
  const rng = createRng(seed);
  beginRound(state, rng);
  let i = 0;
  let guard = 0;
  for (;;) {
    if (guard++ >= 200) throw new Error("回放未在保护次数内结束");
    for (const p of [...state.players]) {
      while (state.phase === "shop" && !p.eliminated && !p.shopDone) {
        const a = log[i];
        if (!a) throw new Error("回放日志耗尽");
        applyAction(state, rng, a);
        i++;
      }
    }
    if (state.phase === "ended") break;
    resolveRound(state, rng);
  }
  expect(i).toBe(log.length); // 日志必须恰好消费完
  return state;
}

function serialize(state: GameState): string {
  return JSON.stringify({
    round: state.round,
    phase: state.phase,
    players: state.players.map((p) => ({
      hp: p.hp,
      gold: p.gold,
      exp: p.exp,
      shopLevel: p.shopLevel,
      rank: p.rank,
      eliminated: p.eliminated,
      hand: p.hand.map((c) => ({ id: c.configId, lv: c.level, atk: c.atk, hp: c.hp, pos: c.position })),
      board: p.board.map((c) => (c ? { id: c.configId, lv: c.level, atk: c.atk, hp: c.hp } : null)),
    })),
    battleLog: state.battleLog,
  });
}

describe("确定性（T2）", () => {
  it("同 seed 两局完整状态完全一致（含棋盘/手牌/战斗日志）", () => {
    for (const seed of [11, 22, 33]) {
      const a = runFullGameLogged(seed).state;
      const b = runFullGameLogged(seed).state;
      expect(serialize(a)).toBe(serialize(b));
    }
  });

  it("不同 seed 产生不同对局（随机性真实生效）", () => {
    const a = serialize(runFullGameLogged(1).state);
    const b = serialize(runFullGameLogged(2).state);
    expect(a).not.toBe(b);
  });
});

describe("回放（T5）", () => {
  it("seed + ActionLog 重放至完全相同终局", () => {
    for (const seed of [5, 6, 7, 8, 9]) {
      const { state: original, log } = runFullGameLogged(seed);
      const replayed = replayFromLog(seed, log);
      expect(serialize(replayed)).toBe(serialize(original));
    }
  });
});
