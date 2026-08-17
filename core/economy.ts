/**
 * 经济逻辑：回合收入/升级商店（金币一次性补经验差）
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

/**
 * 自动升级（用户机制 2026-08-17 修正）：经验 ≥ 所需时自动连续升级，
 * 不经过按钮、不显示"免费升级"。回合开始时在收入/被动之后调用。
 */
export function autoUpgradeIfPossible(player: PlayerState): void {
  let guard = 0;
  for (;;) {
    if (guard++ > 10) throw new Error("autoUpgrade: 升级次数异常");
    const cost = expToUpgrade(player.shopLevel);
    if (cost === null || player.exp < cost) return;
    player.exp -= cost;
    player.shopLevel += 1;
    if (player.shopLevel > shopConfig.maxShopLevel) throw new Error("autoUpgrade: 超出等级上限");
  }
}

/**
 * 升级商店（用户机制，2026-08-17）：
 * 差多少经验 → 一次性付多少金币（1经验=1金币）；经验多出的部分保留到下个等级
 * （自动升级后经验恒小于所需，按钮永远是"补差金币"）
 */
export function upgradeShopAction(player: PlayerState): void {
  const cost = expToUpgrade(player.shopLevel);
  if (cost === null) {
    throw new Error("upgradeShop: 商店已满级");
  }
  const goldPay = Math.max(0, cost - player.exp);
  if (player.gold < goldPay) {
    throw new Error(`upgradeShop: 金币不足（还差 ${goldPay} 金，当前 ${player.gold}）`);
  }
  player.gold -= goldPay;
  player.exp = Math.max(0, player.exp - cost);
  player.shopLevel += 1;
  if (player.shopLevel > shopConfig.maxShopLevel) throw new Error("upgradeShop: 超出等级上限");
}
