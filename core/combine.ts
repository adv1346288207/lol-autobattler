/**
 * 三合一合成（M1，用户实测口径）
 * - 只在购买阶段执行；每次"获得卡牌"后调用
 * - 金卡（level 2）为最高级，不可再合成
 * - 金卡属性：攻击 = 三张之和，血量 = 三张之和（含万能牌自身数值）
 * - 扫描顺序：场上位置 1→6（每个位置作锚点），最后检查纯仓库三张
 * - 万能牌（分裂者）仅在"1 个位置持有 + 仓库 1 张"时补齐；两个位置持有时不补齐
 */
import type { BattleEvent, CardInstance, GameState, PlayerState } from "./state";
import { CARD_BY_ID } from "../config/cards";

/** 合并三张卡为金卡（anchor 留在 anchorPos，其余两张消失） */
function mergeThree(
  state: GameState,
  player: PlayerState,
  anchor: CardInstance,
  b: CardInstance,
  c: CardInstance,
  anchorPos: number | null,
): BattleEvent {
  const gold: CardInstance = {
    uid: state.nextUid++,
    configId: anchor.configId,
    level: 2,
    atk: anchor.atk + b.atk + c.atk,
    hp: anchor.hp + b.hp + c.hp,
    position: anchorPos,
    isFreeRefreshUsed: false,
  };
  removeInstance(player, anchor);
  removeInstance(player, b);
  removeInstance(player, c);
  if (anchorPos === null) {
    player.hand.push(gold);
  } else {
    player.board[anchorPos - 1] = gold;
  }
  return { type: "COMBINE", cardUid: gold.uid, configId: anchor.configId };
}

function removeInstance(player: PlayerState, card: CardInstance): void {
  const handIdx = player.hand.findIndex((c) => c.uid === card.uid);
  if (handIdx >= 0) {
    player.hand.splice(handIdx, 1);
    return;
  }
  const boardIdx = player.board.findIndex((c) => c !== null && c.uid === card.uid);
  if (boardIdx >= 0) {
    player.board[boardIdx] = null;
    return;
  }
  throw new Error(`combine: 找不到卡牌实例 uid=${card.uid}`);
}

function isWildcard(configId: string, kind: "role" | "weapon"): boolean {
  return CARD_BY_ID.get(configId)?.wildcard === kind;
}

/** 场上同 configId 的 level-1 卡（按位置 1→6 顺序） */
function sameOnBoard(player: PlayerState, configId: string, excludeUid?: number): CardInstance[] {
  return player.board.filter(
    (c): c is CardInstance =>
      c !== null && c.level === 1 && c.configId === configId && c.uid !== excludeUid,
  );
}

function sameInHand(player: PlayerState, configId: string): CardInstance[] {
  return player.hand.filter((c) => c.level === 1 && c.configId === configId);
}

/**
 * 对某玩家执行全部可执行的三合一（购买阶段调用；幂等）
 * 返回 COMBINE 事件列表（供渲染层/回放）
 */
export function runCombineChecks(state: GameState, player: PlayerState): BattleEvent[] {
  const events: BattleEvent[] = [];
  let merged = true;
  while (merged) {
    merged = false;
    // ── 情形 A/B：场上位置 1→6 扫描（锚点优先） ──
    for (let pos = 1; pos <= 6; pos++) {
      const anchor = player.board[pos - 1];
      if (!anchor || anchor.level !== 1 || isWildcard(anchor.configId, "role")) continue;
      const onBoard = sameOnBoard(player, anchor.configId, anchor.uid);
      const inHand = sameInHand(player, anchor.configId);
      // A：真卡三张（任意分布），取场上优先
      if (onBoard.length + inHand.length >= 2) {
        const others = [...onBoard, ...inHand].slice(0, 2);
        events.push(mergeThree(state, player, anchor, others[0]!, others[1]!, pos));
        merged = true;
        break; // 重新从头扫描（场上位置可能空出）
      }
      // B：万能补齐——仅"锚点 1 张 + 仓库 1 张 + 分裂者"；双持有（onBoard≥1）不补齐
      if (onBoard.length === 0 && inHand.length >= 1) {
        const wild = player.hand.find(
          (c) => c.level === 1 && isWildcard(c.configId, "role"),
        );
        if (wild) {
          events.push(mergeThree(state, player, anchor, inHand[0]!, wild, pos));
          merged = true;
          break;
        }
      }
    }
    if (merged) continue;
    // ── 情形 C：仓库 3 张真卡（场上无锚点）──
    const counts = new Map<string, CardInstance[]>();
    for (const c of player.hand) {
      if (c.level !== 1 || isWildcard(c.configId, "role")) continue;
      const arr = counts.get(c.configId) ?? [];
      arr.push(c);
      counts.set(c.configId, arr);
    }
    for (const arr of counts.values()) {
      if (arr.length >= 3) {
        events.push(mergeThree(state, player, arr[0]!, arr[1]!, arr[2]!, null));
        merged = true;
        break;
      }
    }
  }
  return events;
}
