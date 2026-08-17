/**
 * Action 定义与应用（地基原则 2.2：玩家/AI/未来网络玩家共用同一通道）
 * 规则：先校验后变更——非法 Action 抛错，状态零污染
 * 返回 COMBINE 事件列表（购买/结束商店阶段可能触发三合一）
 */
import type { BattleEvent, CardInstance, GameState, PlayerState } from "./state";
import { createCardInstance } from "./state";
import type { Rng } from "./rng";
import { CARD_BY_ID } from "../config/cards";
import { shopConfig } from "../config/shop";
import { upgradeShopAction } from "./economy";
import { refreshShop, rollShop, sellCard } from "./shop";
import { runCombineChecks } from "./combine";

export type Action =
  | { type: "buy"; player: number; shopIndex: 0 | 1 | 2 }
  | { type: "sell"; player: number; cardUid: number }
  | { type: "refresh"; player: number }
  | { type: "upgradeShop"; player: number }
  | { type: "move"; player: number; cardUid: number; position: number }
  | { type: "endShop"; player: number };

export const ACTION_TYPES: Action["type"][] = [
  "buy",
  "sell",
  "refresh",
  "upgradeShop",
  "move",
  "endShop",
];

function getPlayer(state: GameState, playerId: number): PlayerState {
  const p = state.players[playerId];
  if (!p) throw new Error(`applyAction: 玩家 ${playerId} 不存在`);
  if (p.eliminated) throw new Error(`applyAction: 玩家 ${playerId} 已淘汰`);
  return p;
}

export function applyAction(state: GameState, rng: Rng, action: Action): BattleEvent[] {
  if (state.phase !== "shop") throw new Error(`applyAction: 非商店阶段（当前 ${state.phase}）`);
  const p = getPlayer(state, action.player);
  // 所有操作都在购买阶段进行：结束商店阶段后不允许再操作（endShop 幂等）
  if (p.shopDone && action.type !== "endShop") {
    throw new Error(`applyAction: 玩家 ${p.id} 已结束商店阶段`);
  }

  switch (action.type) {
    case "buy": {
      const configId = p.shop[action.shopIndex];
      if (configId == null) throw new Error("buy: 该槽位为空");
      const config = CARD_BY_ID.get(configId);
      if (!config) throw new Error(`buy: 未知卡牌 ${configId}`);
      if (p.gold < config.price) throw new Error(`buy: 金币不足（需 ${config.price}，当前 ${p.gold}）`);
      if (p.hand.length >= shopConfig.handLimit) throw new Error(`buy: 手牌已满（上限 ${shopConfig.handLimit}）`);
      p.gold -= config.price;
      p.shop[action.shopIndex] = null;
      p.hand.push(createCardInstance(state, config.id));
      return runCombineChecks(state, p);
    }

    case "sell": {
      sellCard(p, action.cardUid);
      return [];
    }

    case "refresh": {
      refreshShop(state, rng, p);
      return [];
    }

    case "upgradeShop": {
      upgradeShopAction(p);
      return [];
    }

    case "move": {
      applyMove(p, action.cardUid, action.position);
      return [];
    }

    case "endShop": {
      p.shopDone = true;
      // 兜底：结束商店阶段前再做一次合并检测（幂等）
      return runCombineChecks(state, p);
    }
  }
}

/** 移动/交换：手牌或场上卡 → 场上位置 1~6；目标为空则放置，非空则交换 */
function applyMove(p: PlayerState, cardUid: number, position: number): void {
  if (!Number.isInteger(position) || position < 1 || position > shopConfig.boardSize) {
    throw new Error(`move: 非法位置 ${position}（1~${shopConfig.boardSize}）`);
  }
  // 定位卡牌来源
  let card: CardInstance;
  let sourceIdx: number;
  let fromHand: boolean;
  const handIdx = p.hand.findIndex((c) => c.uid === cardUid);
  if (handIdx >= 0) {
    card = p.hand[handIdx]!;
    sourceIdx = handIdx;
    fromHand = true;
  } else {
    const boardIdx = p.board.findIndex((c) => c !== null && c.uid === cardUid);
    if (boardIdx < 0) throw new Error(`move: 找不到卡牌 uid=${cardUid}`);
    card = p.board[boardIdx]!;
    sourceIdx = boardIdx;
    fromHand = false;
  }

  const target = p.board[position - 1] ?? null;

  // 从来源移除
  if (fromHand) {
    p.hand.splice(sourceIdx, 1);
  } else {
    p.board[sourceIdx] = null;
  }

  if (target === null) {
    // 目标为空：直接放置
    card.position = position;
    p.board[position - 1] = card;
    return;
  }

  // 目标非空：交换——来源是手牌 → 目标回手牌；来源是场上 → 目标回来源位
  if (fromHand) {
    target.position = null;
    p.hand.push(target);
  } else {
    target.position = sourceIdx + 1;
    p.board[sourceIdx] = target;
  }
  card.position = position;
  p.board[position - 1] = card;
}
