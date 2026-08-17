/**
 * 商店逻辑（M1）：刷牌/购买/出售/刷新
 * 卡池过滤扩展点：rollShop 内 candidates 处（将来按阵营/每局卡池限制过滤）
 */
import type { GameState, PlayerState } from "./state";
import type { Rng } from "./rng";
import { pick, pickWeighted } from "./rng";
import { CARD_POOL, CARD_BY_ID } from "../config/cards";
import { shopConfig, oddsForLevel } from "../config/shop";

/** 按商店等级概率表刷满 3 个槽位 */
export function rollShop(_state: GameState, rng: Rng, player: PlayerState): void {
  const row = oddsForLevel(player.shopLevel);
  player.shop = Array.from({ length: shopConfig.shopSize }, () => {
    const quality = pickWeighted(rng, {
      green: row.green,
      blue: row.blue,
      purple: row.purple,
      orange: row.orange,
      gold: row.gold,
    });
    // 扩展点：将来按阵营/卡池限制过滤 candidates
    const candidates = CARD_POOL.filter((c) => c.quality === quality);
    if (candidates.length === 0) {
      throw new Error(`rollShop: 品质 ${quality} 无候选卡`);
    }
    return pick(rng, candidates).id;
  });
}

/** 手动刷新：免费刷新次数优先（龙野），否则 1 金 */
export function refreshShop(state: GameState, rng: Rng, player: PlayerState): void {
  if (player.freeRefresh > 0) {
    player.freeRefresh -= 1;
  } else {
    if (player.gold < shopConfig.refreshCost) {
      throw new Error("refresh: 金币不足");
    }
    player.gold -= shopConfig.refreshCost;
  }
  rollShop(state, rng, player);
}

/** 出售：手牌或场上均可，返还买入价 × sellRatio（金卡返还基础价，MVP 简化） */
export function sellCard(player: PlayerState, cardUid: number): void {
  const handIdx = player.hand.findIndex((c) => c.uid === cardUid);
  if (handIdx >= 0) {
    const card = player.hand[handIdx]!;
    player.hand.splice(handIdx, 1);
    player.gold += refundFor(card.configId);
    return;
  }
  const boardIdx = player.board.findIndex((c) => c !== null && c.uid === cardUid);
  if (boardIdx < 0) {
    throw new Error(`sell: 找不到卡牌 uid=${cardUid}`);
  }
  const card = player.board[boardIdx]!;
  player.board[boardIdx] = null;
  player.gold += refundFor(card.configId);
}

function refundFor(configId: string): number {
  const config = CARD_BY_ID.get(configId);
  if (!config) throw new Error(`sell: 未知卡牌 ${configId}`);
  return Math.floor(config.price * shopConfig.sellRatio);
}
