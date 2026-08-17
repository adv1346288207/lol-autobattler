/**
 * 配置合法性校验（M0 验收项：启动/测试时执行）
 */
import { CARD_POOL } from "./cards";
import { shopConfig } from "./shop";
import { economyConfig } from "./economy";

export function validateConfig(): string[] {
  const errors: string[] = [];

  // 概率表每行合计必须 100
  for (const row of shopConfig.qualityOdds) {
    const sum = row.green + row.blue + row.purple + row.orange + row.gold;
    if (sum !== 100) {
      errors.push(`商店等级 ${row.level} 概率合计=${sum}，应为 100`);
    }
  }

  // 卡价必须与价格表一致
  for (const card of CARD_POOL) {
    const expected = shopConfig.priceByQuality[card.quality];
    if (card.price !== expected) {
      errors.push(`卡牌 ${card.id}(${card.name}) 售价 ${card.price} ≠ 品质价目表 ${expected}`);
    }
    if (card.atk < 0 || card.hp < 0) {
      errors.push(`卡牌 ${card.id}(${card.name}) 攻血为负`);
    }
  }

  // 升级经验表单调递增
  for (let i = 1; i < economyConfig.upgradeExpCosts.length - 1; i++) {
    if (economyConfig.upgradeExpCosts[i]! >= economyConfig.upgradeExpCosts[i + 1]!) {
      errors.push(`升级经验表非单调递增（下标 ${i}）`);
    }
  }

  return errors;
}
