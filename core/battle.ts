/**
 * 战斗模拟（M2）
 * - 行动顺序：按位置 1→6 循环，每个位置"我方行动→敌方行动"（交替），死亡者跳过
 * - 攻击目标：对方最前排存活单位（1 号位优先，前后排按位置序）
 * - 重要：战斗在双方棋盘【快照副本】上进行，不污染场上卡牌血量
 * - 产出事件日志（渲染层/回放消费）；BATTLE_END 携带胜方存活卡（平局带双方）
 */
import type { BattleEvent, CardInstance, GameState } from "./state";
import { gameConfig } from "../config/game";

function frontmostAlive(board: (CardInstance | null)[]): CardInstance | null {
  for (const c of board) {
    if (c && c.hp > 0) return c;
  }
  return null;
}

function hasAlive(board: (CardInstance | null)[]): boolean {
  return board.some((c) => c !== null && c.hp > 0);
}

function survivorsOf(board: (CardInstance | null)[], playerId: number) {
  return board
    .filter((c): c is CardInstance => c !== null && c.hp > 0)
    .map((c) => ({ player: playerId, cardUid: c.uid, hp: c.hp }));
}

function endEvent(
  winner: number | null,
  boardA: (CardInstance | null)[],
  boardB: (CardInstance | null)[],
  aId: number,
  bId: number,
): BattleEvent {
  const surv = winner === null
    ? [...survivorsOf(boardA, aId), ...survivorsOf(boardB, bId)]
    : winner === aId
      ? survivorsOf(boardA, aId)
      : survivorsOf(boardB, bId);
  return { type: "BATTLE_END", winner, survivors: surv };
}

export function simulateBattle(state: GameState, aId: number, bId: number): BattleEvent[] {
  const pa = state.players[aId]!;
  const pb = state.players[bId]!;
  // 快照副本：战斗中的血量变化不影响真实场上卡牌（每场战斗满血开打）
  const boardA = pa.board.map((c) => (c ? { ...c } : null));
  const boardB = pb.board.map((c) => (c ? { ...c } : null));
  const events: BattleEvent[] = [{ type: "BATTLE_START", a: aId, b: bId }];

  let steps = 0;
  let pos = 1;

  for (;;) {
    const aHas = hasAlive(boardA);
    const bHas = hasAlive(boardB);
    if (!aHas && !bHas) {
      events.push(endEvent(null, boardA, boardB, aId, bId)); // 平局
      return events;
    }
    if (!aHas) {
      events.push(endEvent(bId, boardA, boardB, aId, bId));
      return events;
    }
    if (!bHas) {
      events.push(endEvent(aId, boardA, boardB, aId, bId));
      return events;
    }

    // 我方 pos 位行动
    const cardA = boardA[pos - 1];
    if (cardA && cardA.hp > 0) {
      const target = frontmostAlive(boardB);
      if (target) {
        target.hp -= cardA.atk;
        events.push({ type: "ATTACK", from: cardA.uid, to: target.uid, dmg: cardA.atk });
        if (target.hp <= 0) events.push({ type: "DEATH", who: target.uid });
      }
      steps++;
    }
    // 敌方 pos 位行动
    const cardB = boardB[pos - 1];
    if (cardB && cardB.hp > 0) {
      const target = frontmostAlive(boardA);
      if (target) {
        target.hp -= cardB.atk;
        events.push({ type: "ATTACK", from: cardB.uid, to: target.uid, dmg: cardB.atk });
        if (target.hp <= 0) events.push({ type: "DEATH", who: target.uid });
      }
      steps++;
    }

    pos = (pos % 6) + 1;

    // 防死循环保护：超步数按剩余血量总和判定
    if (steps >= gameConfig.maxBattleSteps) {
      const sumA = boardA.reduce((s, c) => s + (c && c.hp > 0 ? c.hp : 0), 0);
      const sumB = boardB.reduce((s, c) => s + (c && c.hp > 0 ? c.hp : 0), 0);
      if (sumA === sumB) events.push(endEvent(null, boardA, boardB, aId, bId));
      else if (sumA > sumB) events.push(endEvent(aId, boardA, boardB, aId, bId));
      else events.push(endEvent(bId, boardA, boardB, aId, bId));
      return events;
    }
  }
}
