/**
 * 测试辅助：构建对局状态、放置卡牌
 */
import { createGame, createCardInstance, type CardInstance, type GameState, type PlayerState } from "../core/state";
import { createRng, type Rng } from "../core/rng";

export interface TestCtx {
  state: GameState;
  rng: Rng;
  p: PlayerState;
}

export function makeCtx(seed = 12345): TestCtx {
  const state = createGame(seed);
  const rng = createRng(seed);
  return { state, rng, p: state.players[0]! };
}

/** 给玩家手牌加一张卡（返回实例） */
export function giveHand(state: GameState, p: PlayerState, configId: string): CardInstance {
  const c = createCardInstance(state, configId);
  p.hand.push(c);
  return c;
}

/** 把一张卡放到场上指定位置（1~6） */
export function place(state: GameState, p: PlayerState, configId: string, pos: number): CardInstance {
  const c = createCardInstance(state, configId);
  c.position = pos;
  p.board[pos - 1] = c;
  return c;
}

/** 手牌中找指定 configId 的卡 */
export function handOf(p: PlayerState, configId: string): CardInstance[] {
  return p.hand.filter((c) => c.configId === configId);
}

/** 场上非空卡列表（按位置 1→6） */
export function boardCards(p: PlayerState): CardInstance[] {
  return p.board.filter((c): c is CardInstance => c !== null);
}
