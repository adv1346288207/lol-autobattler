/**
 * 商店逻辑（M1）：刷牌/购买/出售/刷新
 * 卡池过滤扩展点：rollShop 内 candidates 处（将来按阵营/每局卡池限制过滤）
 */
import type { CardInstance, GameState, PlayerState } from "./state";
import type { Rng } from "./rng";
import { pick, pickWeighted } from "./rng";
import { CARD_POOL, CARD_BY_ID } from "../config/cards";
import { shopConfig, oddsForLevel } from "../config/shop";

/**
 * 同一品质内的抽取权重：英雄 3、武器 1。
 * 武器和英雄共用卡池，若等概率抽取，武器会占掉约 38% 的商店位，
 * 实测会把需要特定英雄的羁绊（射手线）压到 lift 0.77；给英雄 3 倍权重后
 * 武器约占 17% 的商店位，羁绊成型难度回到加武器之前的水平。
 */
const HERO_SHOP_WEIGHT = 3;
const WEAPON_SHOP_WEIGHT = 1;

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
    // 加权抽取（英雄优先），保证羁绊成型机会不被武器挤占
    const weighted = candidates.flatMap((c) =>
      Array<typeof c>(c.type === "weapon" ? WEAPON_SHOP_WEIGHT : HERO_SHOP_WEIGHT).fill(c),
    );
    return pick(rng, weighted).id;
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

/**
 * 出售：手牌、场上或武器库存均可，返还买入价 × sellRatio。
 * ⚠️ 卖掉带装备的英雄时，装备必须**退回武器库**（武器库满了就按售价折成金币），
 * 绝不能让装备凭空消失——这是之前的一个真 bug。
 */
export function sellCard(player: PlayerState, cardUid: number): void {
  const handIdx = player.hand.findIndex((c) => c.uid === cardUid);
  if (handIdx >= 0) {
    const card = player.hand[handIdx]!;
    player.hand.splice(handIdx, 1);
    refundCard(player, card);
    return;
  }
  const boardIdx = player.board.findIndex((c) => c !== null && c.uid === cardUid);
  if (boardIdx >= 0) {
    const card = player.board[boardIdx]!;
    player.board[boardIdx] = null;
    refundCard(player, card);
    return;
  }
  const weaponIdx = player.weapons.findIndex((w) => w.uid === cardUid);
  if (weaponIdx >= 0) {
    const weapon = player.weapons[weaponIdx]!;
    player.weapons.splice(weaponIdx, 1);
    player.gold += refundFor(weapon.configId);
    return;
  }
  throw new Error(`sell: 找不到卡牌 uid=${cardUid}`);
}

/** 返一张卡的钱，并把它的装备退回武器库（放不下就折价给金币，绝不吞掉价值） */
function refundCard(player: PlayerState, card: CardInstance): void {
  player.gold += refundFor(card.configId);
  if (card.equips.length === 0) return;
  for (const weapon of card.equips) {
    if (player.weapons.length < shopConfig.weaponLimit) {
      player.weapons.push(weapon);
    } else {
      player.gold += refundFor(weapon.configId);
    }
  }
  card.equips = [];
}

function refundFor(configId: string): number {
  const config = CARD_BY_ID.get(configId);
  if (!config) throw new Error(`sell: 未知卡牌 ${configId}`);
  return Math.floor(config.price * shopConfig.sellRatio);
}
