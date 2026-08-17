/**
 * 配对（M2）：存活者随机两两配对、奇数轮空、不与上回合对手重复
 * - 用 DFS 求"避开上回合对手"的完美匹配（n≥4 时必然存在；n=2 时允许重复）
 * - 全部决策走 seed RNG → 可回放
 */
import type { GameState } from "./state";
import { alivePlayers } from "./state";
import type { Rng } from "./rng";
import { randInt } from "./rng";

export interface Pairing {
  a: number;
  b: number | null; // null = 轮空
}

function shuffle<T>(arr: T[], rng: Rng): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(rng, 0, i);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}

/** DFS 求避开 prev 对手的完美匹配；无解（仅剩 2 人时）返回 null */
function matchAvoidPrev(ids: number[], prev: (number | null)[]): [number, number][] | null {
  if (ids.length === 0) return [];
  const a = ids[0]!;
  for (let i = 1; i < ids.length; i++) {
    const b = ids[i]!;
    if (prev[a] === b || prev[b] === a) continue;
    const rest = ids.slice(1, i).concat(ids.slice(i + 1));
    const sub = matchAvoidPrev(rest, prev);
    if (sub) return [[a, b], ...sub];
  }
  return null;
}

export function pairPlayers(state: GameState, rng: Rng): Pairing[] {
  const ids = alivePlayers(state).map((p) => p.id);
  shuffle(ids, rng);
  const prev = state.lastOpponent.slice(); // 以"上一回合"的对手表做约束，本回合新配对互不干扰
  const pairs: Pairing[] = [];

  // 奇数人数：随机 1 人轮空（shuffle 后取最后一人）
  if (ids.length % 2 === 1) {
    const bye = ids.pop()!;
    pairs.push({ a: bye, b: null });
    state.lastOpponent[bye] = null;
  }

  const matched = matchAvoidPrev(ids, prev);

  // DFS 无解仅发生在只剩 2 人且互为上回合对手时：直接配对，允许重复
  let final: [number, number][];
  if (matched) {
    final = matched;
  } else if (ids.length === 2) {
    final = [[ids[0]!, ids[1]!]];
  } else {
    final = []; // 理论不可达（n≥4 必有解），防御性兜底
  }

  for (const [a, b] of final) {
    pairs.push({ a, b });
    state.lastOpponent[a] = b;
    state.lastOpponent[b] = a;
  }
  return pairs;
}
