/**
 * 武器卡配置（装备系统）
 * ── 武器是**装备**：进商店买卖、3 张同名合成二星，再装备到英雄身上生效 ──
 * - 每名英雄 1 个武器槽；武器**不参与羁绊**（没有地区/职业），不占手牌也不占上阵位
 * - 品质同样是 绿/蓝/紫/橙/金；**金色武器是武器线的万能牌**：
 *   2 张同名武器 + 1 张金武器 → 二星武器；1 张武器 + 2 张金武器 → 也是二星武器。
 *   按用户要求，金武器自身没有特殊效果，只是一张普通加攻的卡。
 * - 蓝卡及以上各带**一条战斗被动**（复用 core/effects.ts 的被动系统）：
 *     开战加成 / 首次击杀成长 / 首次施法成长 / 首次致命伤回溯
 *   带被动的武器都相应下调了基础攻血，避免"加了效果还更强"。
 * - 图标用 Riot Data Dragon 官方装备图标（64×64），卡面居中展示。
 */
import type { CardConfig } from "./cards";

const PRICE = { green: 1, blue: 2, purple: 3, orange: 4, gold: 4 } as const;

interface WeaponSpec {
  id: string;
  name: string;
  itemId: string;
  quality: CardConfig["quality"];
  atk: number;
  hp: number;
  /** 卡面/图鉴上的一句话说明 */
  desc: string;
  passive?: CardConfig["passives"][number];
  wildcard?: "weapon";
}

function weapon(spec: WeaponSpec): CardConfig {
  return {
    id: spec.id,
    name: spec.name,
    type: "weapon",
    quality: spec.quality,
    atk: spec.atk,
    hp: spec.hp,
    price: PRICE[spec.quality],
    region: null,
    professions: [],
    image: `/assets/lol/items/${spec.itemId}.png`,
    portrait: null,
    itemId: spec.itemId,
    maxMana: 0,
    startMana: 0,
    skill: null,
    passives: spec.passive ? [spec.passive] : [],
    skills: [],
    weaponDesc: spec.desc,
    ...(spec.wildcard ? { wildcard: spec.wildcard } : {}),
  };
}

/** 被动简写：开战永久加攻 */
function startAtk(atk: [number, number], desc: string): CardConfig["passives"][number] {
  return { trigger: "on_battle_start", effect: "attack_buff", value: atk, desc };
}
/** 被动简写：首次击杀后永久加攻 */
function killAtk(atk: [number, number], desc: string): CardConfig["passives"][number] {
  return { trigger: "on_kill", effect: "attack_buff", value: atk, desc };
}
/** 被动简写：开战护盾 */
function startShield(shield: [number, number], desc: string): CardConfig["passives"][number] {
  return { trigger: "on_battle_start", effect: "shield", value: shield, desc };
}

export const WEAPON_CARDS: CardConfig[] = [
  /* ── 绿（1 金）：基础装备，没有被动，纯数值 ── */
  weapon({ id: "long_sword", name: "长剑", itemId: "1036", quality: "green", atk: 3, hp: 3, desc: "最基础的攻击装备" }),
  weapon({ id: "dagger", name: "短剑", itemId: "1042", quality: "green", atk: 4, hp: 2, desc: "纯攻击，牺牲生存" }),
  weapon({ id: "cloth_armor", name: "布甲", itemId: "1029", quality: "green", atk: 1, hp: 6, desc: "便宜的肉装" }),

  /* ── 蓝（2 金）：第一条被动 ── */
  weapon({
    id: "recurve_bow",
    name: "反曲之弓",
    itemId: "1043",
    quality: "blue",
    atk: 4,
    hp: 4,
    desc: "开战攻击 +1/+2",
    passive: startAtk([1, 2], "开战时永久 +1/+2 攻击"),
  }),
  weapon({
    id: "pickaxe",
    name: "十字镐",
    itemId: "1037",
    quality: "blue",
    atk: 6,
    hp: 3,
    desc: "首次击杀后攻击 +2/+4",
    passive: killAtk([2, 4], "首次击杀后永久 +2/+4 攻击"),
  }),
  weapon({
    id: "chain_vest",
    name: "锁子甲",
    itemId: "1031",
    quality: "blue",
    atk: 2,
    hp: 7,
    desc: "开战获得 3/6 护盾",
    passive: startShield([3, 6], "开战时获得 3/6 点护盾"),
  }),

  /* ── 紫（3 金）：成型装备 ── */
  weapon({
    id: "infinity_edge",
    name: "无尽之刃",
    itemId: "3031",
    quality: "purple",
    atk: 8,
    hp: 6,
    desc: "首次击杀后攻击 +3/+6",
    passive: killAtk([3, 6], "首次击杀后永久 +3/+6 攻击"),
  }),
  weapon({
    id: "runaans_hurricane",
    name: "卢安娜的飓风",
    itemId: "3085",
    quality: "purple",
    atk: 7,
    hp: 7,
    desc: "首次施法后回复 10/20 法力",
    passive: { trigger: "on_skill_cast", effect: "mana_gain", value: [10, 20], desc: "首次施法后立刻回复 10/20 法力" },
  }),
  weapon({
    id: "thornmail",
    name: "荆棘之甲",
    itemId: "3075",
    quality: "purple",
    atk: 4,
    hp: 11,
    desc: "开战获得 5/10 护盾",
    passive: startShield([5, 10], "开战时获得 5/10 点护盾"),
  }),

  /* ── 橙（4 金）：终局装备 ── */
  weapon({
    id: "blade_of_the_ruined_king",
    name: "破败王者之刃",
    itemId: "3153",
    quality: "orange",
    atk: 10,
    hp: 8,
    desc: "首次击杀后继承目标 30%/50% 攻击",
    passive: {
      trigger: "on_kill",
      effect: "steal_attack",
      ratio: [0.3, 0.5],
      desc: "首次击杀后，永久继承目标 30%/50% 的基础攻击力",
    },
  }),
  weapon({
    id: "guardian_angel",
    name: "守护天使",
    itemId: "3026",
    quality: "orange",
    atk: 6,
    hp: 12,
    desc: "首次致命伤以 30%/50% 生命复活",
    passive: {
      trigger: "on_lethal_damage",
      effect: "revive_rewind",
      ratio: [0.3, 0.5],
      oncePerBattle: true,
      desc: "首次受到致命伤害时不死，以 30%/50% 生命复活",
    },
  }),
  weapon({
    id: "rabadons_deathcap",
    name: "灭世者的死亡之帽",
    itemId: "3089",
    quality: "orange",
    atk: 9,
    hp: 9,
    desc: "首次施法后攻击 +3/+6",
    passive: { trigger: "on_skill_cast", effect: "attack_buff", value: [3, 6], desc: "首次施法后永久 +3/+6 攻击" },
  }),

  /* ── 金（4 金）：武器线万能牌，本身只是普通加攻 ── */
  weapon({
    id: "hextech_gunblade",
    name: "海克斯科技枪刃",
    itemId: "3146",
    quality: "gold",
    atk: 8,
    hp: 6,
    wildcard: "weapon",
    desc: "武器万能牌 · 无特殊效果",
  }),
];

export const WEAPON_BY_ID: ReadonlyMap<string, CardConfig> = new Map(WEAPON_CARDS.map((c) => [c.id, c]));

/** 武器线的金色万能牌（三合一补齐用） */
export const WEAPON_WILDCARD_IDS: string[] = WEAPON_CARDS.filter((c) => c.wildcard === "weapon").map((c) => c.id);
