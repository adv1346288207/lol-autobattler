/**
 * Action 定义与应用（地基原则 2.2：玩家/AI/未来网络玩家共用同一通道）
 * 规则：先校验后变更——非法 Action 抛错，状态零污染
 * 返回 COMBINE 事件列表（购买/结束商店阶段可能触发三合一）
 */
import type { BattleEvent, CardInstance, GameState, PlayerState } from "./state";
import { createCardInstance, createEquipInstance, EQUIP_SLOTS } from "./state";
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
  /** 把武器库存里的武器装备到某名英雄身上（该英雄原有装备退回库存） */
  | { type: "equip"; player: number; weaponUid: number; cardUid: number }
  /** 卸下某名英雄的装备，退回武器库存 */
  | { type: "unequip"; player: number; cardUid: number; weaponUid: number }
  | { type: "endShop"; player: number };

export const ACTION_TYPES: Action["type"][] = [
  "buy",
  "sell",
  "refresh",
  "upgradeShop",
  "move",
  "equip",
  "unequip",
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
      if (config.type === "weapon") {
        // 武器进武器库存（不占手牌与上阵位），随后做武器三合一
        if (p.weapons.length >= shopConfig.weaponLimit) {
          throw new Error(`buy: 武器库已满（上限 ${shopConfig.weaponLimit}）`);
        }
        p.gold -= config.price;
        p.shop[action.shopIndex] = null;
        p.weapons.push(createEquipInstance(state, config.id));
        return runCombineChecks(state, p);
      }
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

    case "equip": {
      applyEquip(p, action.weaponUid, action.cardUid);
      return [];
    }

    case "unequip": {
      applyUnequip(p, action.cardUid, action.weaponUid);
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

/** 武器强弱排序分（AI 与替换逻辑共用） */
export function weaponScore(w: { atk: number; hp: number }): number {
  return w.atk * 2 + w.hp;
}

/**
 * 装备：武器库存 → 英雄身上。
 * - 还有空槽 → 直接装上（每名英雄 EQUIP_SLOTS 个槽）
 * - 两个槽都满 → 替换**较弱**的那件，被替换的退回武器库存（数值不凭空消失）
 */
function applyEquip(p: PlayerState, weaponUid: number, cardUid: number): void {
  const weaponIdx = p.weapons.findIndex((w) => w.uid === weaponUid);
  if (weaponIdx < 0) throw new Error(`equip: 武器库里没有 uid=${weaponUid}`);
  const card = findCard(p, cardUid);
  if (!card) throw new Error(`equip: 找不到英雄 uid=${cardUid}`);
  const config = CARD_BY_ID.get(card.configId);
  if (config?.type === "duplicator") {
    throw new Error(`equip: ${config.name} 不能装备武器`);
  }
  const weapon = p.weapons[weaponIdx]!;
  p.weapons.splice(weaponIdx, 1);
  if (card.equips.length < EQUIP_SLOTS) {
    card.equips.push(weapon);
    return;
  }
  let weakest = 0;
  for (let i = 1; i < card.equips.length; i++) {
    if (weaponScore(card.equips[i]!) < weaponScore(card.equips[weakest]!)) weakest = i;
  }
  const replaced = card.equips[weakest]!;
  card.equips[weakest] = weapon;
  p.weapons.push(replaced);
}

/** 卸下指定的一件装备：英雄 → 武器库存 */
function applyUnequip(p: PlayerState, cardUid: number, weaponUid: number): void {
  const card = findCard(p, cardUid);
  if (!card) throw new Error(`unequip: 找不到英雄 uid=${cardUid}`);
  const idx = card.equips.findIndex((e) => e.uid === weaponUid);
  if (idx < 0) throw new Error(`unequip: 该英雄身上没有武器 uid=${weaponUid}`);
  if (p.weapons.length >= shopConfig.weaponLimit) {
    throw new Error(`unequip: 武器库已满（上限 ${shopConfig.weaponLimit}）`);
  }
  p.weapons.push(card.equips[idx]!);
  card.equips.splice(idx, 1);
}

/** 在手牌或场上按 uid 找卡 */
export function findCard(p: PlayerState, cardUid: number): CardInstance | null {
  return (
    p.hand.find((c) => c.uid === cardUid) ??
    p.board.find((c): c is CardInstance => c !== null && c.uid === cardUid) ??
    null
  );
}

/** 移动/交换：手牌或场上卡 → 场上位置 1~6（目标为空则放置，非空则交换）；位置 0 = 场上卡回手牌 */
function applyMove(p: PlayerState, cardUid: number, position: number): void {
  if (!Number.isInteger(position) || position < 0 || position > shopConfig.boardSize) {
    throw new Error(`move: 非法位置 ${position}（0=回手牌，1~${shopConfig.boardSize}=棋盘位）`);
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

  // 位置 0：场上卡 → 回手牌（手牌卡执行则抛错）
  if (position === 0) {
    if (fromHand) throw new Error("move: 该卡已在手牌");
    p.board[sourceIdx] = null;
    card.position = null;
    p.hand.push(card);
    return;
  }

  const target = p.board[position - 1] ?? null;

  // 万能牌（英雄复制器）只能留在仓库参与合成，不能上阵
  const cardConfig = CARD_BY_ID.get(card.configId);
  if (cardConfig?.type === "duplicator") {
    throw new Error(`move: ${cardConfig.name} 不能上阵（只用于合成补齐）`);
  }

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
