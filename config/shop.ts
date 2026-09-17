/**
 * 商店配置
 * 橙卡概率已确认：L1~L3=0、L4=10、L5=30
 * 绿/蓝/紫/金（分裂者）为占位值，待用户提供各等级完整分布后替换
 */

export const shopConfig = {
  /** 商店每回合展示槽位数 */
  shopSize: 3,
  /** 手动刷新费用 */
  refreshCost: 1,
  /** 手牌上限 */
  handLimit: 15,
  /** 武器库存上限（装备前存放武器的位置） */
  weaponLimit: 8,
  /** 场上卡位（前3后3） */
  boardSize: 6,
  /** 商店最高等级 */
  maxShopLevel: 5,
  /** 出售价 = 买入价 */
  sellRatio: 1,
  /** 各品质售价 */
  priceByQuality: { green: 1, blue: 2, purple: 3, orange: 4, gold: 4 },
  /**
   * 各等级刷出品质概率（每行合计 100）
   * 金卡列 MVP 只产出分裂者；合成产出的金卡不进商店
   */
  qualityOdds: [
    { level: 1, green: 70, blue: 20, purple: 7, orange: 0, gold: 3 },
    { level: 2, green: 55, blue: 25, purple: 17, orange: 0, gold: 3 },
    { level: 3, green: 35, blue: 30, purple: 32, orange: 0, gold: 3 },
    { level: 4, green: 20, blue: 25, purple: 42, orange: 10, gold: 3 },
    { level: 5, green: 10, blue: 20, purple: 30, orange: 30, gold: 10 },
  ],
} as const;

export function oddsForLevel(shopLevel: number): { green: number; blue: number; purple: number; orange: number; gold: number } {
  const row = shopConfig.qualityOdds.find((r) => r.level === shopLevel);
  if (!row) throw new Error(`oddsForLevel: 未知商店等级 ${shopLevel}`);
  return row;
}
