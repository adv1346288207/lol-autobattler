/**
 * 卡池配置（全配置化原则：新卡 = 新配置行）
 * ⚠️ 攻/血为占位数值（仅用于跑通框架），待用户实机截图提供全部角色初始属性后替换
 * 术语：橙卡 = 品质档位；金卡 = 三张同卡合成产物（独立于品质体系，商店里的金卡列只出分裂者）
 */
import type { SkillConfig } from "../core/state";

export interface CardConfig {
  id: string;
  name: string;
  type: "role"; // 本期只有 role；将来扩展 weapon/item/throwable/consumable
  quality: "green" | "blue" | "purple" | "orange" | "gold"; // gold 仅万能牌分裂者使用
  atk: number; // 占位：待用户提供
  hp: number; // 占位：待用户提供
  price: number;
  faction: string | null; // 阵营（本期不启用，字段先留）
  wildcard?: "role" | "weapon"; // 万能补齐牌标记
  skills: SkillConfig[]; // 技能数值 × 卡牌 level（金卡技能翻倍：兰+1经验→金兰+2）
}

export const CARD_POOL: CardConfig[] = [
  { id: "loey", name: "洛伊", type: "role", quality: "green", atk: 1, hp: 5, price: 1, faction: null, skills: [] },
  { id: "seth", name: "赛斯", type: "role", quality: "green", atk: 2, hp: 3, price: 1, faction: null, skills: [] },
  { id: "swat", name: "斯沃特", type: "role", quality: "green", atk: 2, hp: 4, price: 1, faction: null, skills: [] },
  {
    id: "lan",
    name: "兰",
    type: "role",
    quality: "blue",
    atk: 2,
    hp: 2,
    price: 2,
    faction: null,
    skills: [{ trigger: "turn_start", effect: "gain_exp", params: { n: 1 }, oncePerTurn: true }],
  },
  {
    id: "longye",
    name: "龙野",
    type: "role",
    quality: "blue",
    atk: 2,
    hp: 3,
    price: 2,
    faction: null,
    skills: [{ trigger: "turn_start", effect: "free_refresh", params: { n: 1 }, oncePerTurn: true }],
  },
  { id: "aogu", name: "傲骨", type: "role", quality: "blue", atk: 3, hp: 3, price: 2, faction: null, skills: [] },
  { id: "daofeng", name: "刀锋", type: "role", quality: "purple", atk: 4, hp: 6, price: 3, faction: null, skills: [] },
  { id: "zhujiuyin", name: "烛九阴", type: "role", quality: "purple", atk: 4, hp: 8, price: 3, faction: null, skills: [] },
  { id: "taitan", name: "泰坦", type: "role", quality: "orange", atk: 6, hp: 12, price: 4, faction: null, skills: [] },
  { id: "wumei", name: "妩媚妖姬", type: "role", quality: "orange", atk: 5, hp: 8, price: 4, faction: null, skills: [] },
  {
    // 攻血占位 0/0，待用户提供
    id: "fenliezhe",
    name: "分裂者",
    type: "role",
    quality: "gold",
    atk: 0,
    hp: 0,
    price: 4,
    faction: null,
    wildcard: "role",
    skills: [],
  },
];

export const CARD_BY_ID: ReadonlyMap<string, CardConfig> = new Map(CARD_POOL.map((c) => [c.id, c]));
