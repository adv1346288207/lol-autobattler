/**
 * 经济逻辑（M1）：回合收入/买经验/升级商店
 * 校验失败直接抛错，调用方保证状态不被污染
 */
import type { PlayerState } from "./state";
import { economyConfig, expToUpgrade } from "../config/economy";
import { shopConfig } from "../config/shop";

/** 回合开始收入（金币阶梯 + 自动经验；freeRefresh 清零由 phase.beginRound 负责） */
export function applyRoundIncome(player: PlayerState, round: number): void {
  player.gold += economyGoldForRound(round);
  player.exp += economyConfig.baseExpPerRound;
}

function economyGoldForRound(round: number): number {
  if (round <= economyConfig.goldEarlyRounds) {
    return economyConfig.goldStart + (round - 1) * economyConfig.goldEarlyStep;
  }
  const earlyLast =
    economyConfig.goldStart + (economyConfig.goldEarlyRounds - 1) * economyConfig.goldEarlyStep;
  return Math.min(
    economyConfig.goldCap,
    earlyLast + (round - economyConfig.goldEarlyRounds) * economyConfig.goldLateStep,
  );
}

/** 买经验：2 金 = 1 经验 */
export function buyExpAction(player: PlayerState): void {
  if (player.gold < economyConfig.goldPerExp) {
    throw new Error("buyExp: 金币不足");
  }
  player.gold -= economyConfig.goldPerExp;
  player.exp += 1;
}

/** 升级商店：消耗经验，5 级满 */
export function upgradeShopAction(player: PlayerState): void {
  const cost = expToUpgrade(player.shopLevel);
  if (cost === null) {
    throw new Error("upgradeShop: 商店已满级");
  }
  if (player.exp < cost) {
    throw new Error(`upgradeShop: 经验不足（需 ${cost}，当前 ${player.exp}）`);
  }
  player.exp -= cost;
  player.shopLevel += 1;
  if (player.shopLevel > shopConfig.maxShopLevel) throw new Error("upgradeShop: 超出等级上限");
}
