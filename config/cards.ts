/**
 * 卡池配置（全配置化原则：新卡 = 新配置行）
 * ── 正式卡池 CARD_POOL：20 名 LoL 英雄 + 1 张英雄复制器（万能合成牌） ──
 * ── LEGACY_CARDS：改造前的旧占位卡，仅供旧测试/旧存档引用，不进商店 ──
 * 术语：橙卡 = 品质档位；金卡 = 三张同卡合成产物（level 2）
 *
 * 英雄数据来源：LOL改编实施方案.md §15（首轮功能规格，不要求复刻正式 LoL 数值）
 * 技能一律由"通用效果 + 参数"组合，战斗主循环不为单个英雄开分支。
 */
import type { ActiveSkillConfig, PassiveConfig, SkillConfig, StarPair } from "../core/state";
import type { Profession, Region } from "./traits";
import { WEAPON_CARDS } from "./weapons";

export interface CardConfig {
  id: string;
  /** Riot Data Dragon 官方 ID（大小写敏感）；英雄复制器/旧卡没有 */
  dataDragonId?: string;
  /** Data Dragon 装备 ID（仅武器卡） */
  itemId?: string;
  name: string;
  type: "hero" | "weapon" | "duplicator" | "role";
  quality: "green" | "blue" | "purple" | "orange" | "gold";
  atk: number;
  hp: number;
  price: number;
  /** 地区羁绊（英雄复制器/武器/旧卡为 null） */
  region: Region | null;
  /** 职业羁绊（0~2 个） */
  professions: Profession[];
  /** 本地头像路径（web/public 下）；无图时前端用 CSS 占位 */
  image: string | null;
  /** 本地卡面立绘（Data Dragon loading 图，308×560 竖版）；加载失败回退到 image */
  portrait: string | null;
  /** 技能所需法力 */
  maxMana: number;
  /** 开战初始法力 */
  startMana: number;
  /** 主动技能（满法力后施放）；武器/复制器/旧卡为 null */
  skill: ActiveSkillConfig | null;
  /** 战斗被动（击杀成长、致命回溯等） */
  passives: PassiveConfig[];
  /** 商店阶段被动（旧体系：兰 +经验 / 龙野 +免费刷新） */
  skills: SkillConfig[];
  /**
   * 成长属性（只有部分英雄有）：**上阵期间**每隔 `every` 回合永久 +atk/+hp。
   * 累计值记在卡实例的 growthAtk/growthHp 上，不污染 card.atk/hp 的基础值。
   */
  growth?: { atk?: number; hp?: number; every?: number };
  /** 武器卡的一句话说明（卡面与图鉴展示用） */
  weaponDesc?: string;
  /** 万能补齐牌标记：role = 英雄线，weapon = 武器线 */
  wildcard?: "role" | "weapon";
}

const PRICE = { green: 1, blue: 2, purple: 3, orange: 4, gold: 4 } as const;

/** 英雄卡工厂：统一补 price/image/type，减少配置行噪声 */
function hero(cfg: {
  id: string;
  dataDragonId: string;
  name: string;
  quality: CardConfig["quality"];
  atk: number;
  hp: number;
  region: Region;
  professions: Profession[];
  startMana: number;
  maxMana: number;
  skill: ActiveSkillConfig;
  passives?: PassiveConfig[];
  growth?: CardConfig["growth"];
}): CardConfig {
  const { passives, ...rest } = cfg;
  return {
    ...rest,
    type: "hero",
    price: PRICE[cfg.quality],
    image: `/assets/lol/champions/${cfg.dataDragonId}.png`,
    portrait: `/assets/lol/portraits/${cfg.dataDragonId}.jpg`,
    skill: cfg.skill,
    passives: passives ?? [],
    skills: [],
  };
}

/* ══════════════ 20 名英雄 ══════════════ */

export const HERO_CARDS: CardConfig[] = [
  /* ── 德玛西亚 ── */
  hero({
    id: "garen",
    dataDragonId: "Garen",
    name: "盖伦",
    quality: "green",
    atk: 2,
    hp: 7,
    region: "demacia",
    professions: ["vanguard", "warrior"],
    startMana: 0,
    maxMana: 60,
    skill: {
      id: "garen_judgment",
      name: "审判",
      brief: "全体伤害 + 自身护盾",
      desc: "旋转巨剑，对全体敌人造成 3/5 伤害，自身获得 4/8 护盾。",
      steps: [
        { effect: "damage", target: "all_enemies", value: [3, 5] },
        { effect: "shield", target: "self", value: [4, 8] },
      ],
    },
  }),
  hero({
    id: "poppy",
    dataDragonId: "Poppy",
    name: "波比",
    quality: "blue",
    atk: 2,
    hp: 8,
    region: "demacia",
    professions: ["vanguard"],
    startMana: 20,
    maxMana: 70,
    skill: {
      id: "poppy_heroic_charge",
      name: "英勇冲撞",
      brief: "单体眩晕 + 自身护盾",
      desc: "冲撞当前目标造成 6/10 伤害并眩晕 1/2 次行动，自身获得 3/6 护盾。",
      steps: [
        { effect: "damage", target: "current_target", value: [6, 10] },
        { effect: "stun", target: "same_as_previous", duration: [1, 2] },
        { effect: "shield", target: "self", value: [3, 6] },
      ],
    },
  }),
  hero({
    id: "lux",
    dataDragonId: "Lux",
    name: "拉克丝",
    quality: "purple",
    atk: 4,
    hp: 5,
    region: "demacia",
    professions: ["mage", "support"],
    startMana: 30,
    maxMana: 80,
    skill: {
      id: "lux_final_spark",
      name: "终极闪光",
      brief: "后排伤害 + 友方护盾",
      desc: "对敌方后排造成 8/14 伤害，并为生命最低的友方提供 5/9 护盾。",
      steps: [
        { effect: "damage", target: "backmost", value: [8, 14] },
        { effect: "shield", target: "lowest_hp_ally", value: [5, 9] },
      ],
    },
  }),
  hero({
    id: "jarvan_iv",
    dataDragonId: "JarvanIV",
    name: "嘉文四世",
    quality: "orange",
    atk: 5,
    hp: 9,
    region: "demacia",
    professions: ["warrior", "support"],
    startMana: 20,
    maxMana: 90,
    skill: {
      id: "jarvan_cataclysm",
      name: "天崩地裂",
      brief: "后排伤害 + 全体护盾",
      desc: "跃向敌方后排造成 9/15 伤害，并为全体友方提供 2/4 护盾。",
      steps: [
        { effect: "damage", target: "backmost", value: [9, 15] },
        { effect: "shield", target: "all_allies", value: [2, 4] },
      ],
    },
  }),

  /* ── 诺克萨斯 ── */
  hero({
    id: "darius",
    dataDragonId: "Darius",
    name: "德莱厄斯",
    quality: "green",
    atk: 3,
    hp: 7,
    region: "noxus",
    professions: ["warrior"],
    growth: { atk: 1 },
    startMana: 0,
    maxMana: 60,
    skill: {
      id: "darius_guillotine",
      name: "诺克萨斯断头台",
      brief: "残血斩杀 + 击杀追击",
      desc: "对生命最低的敌人造成 10/16 伤害；目标生命低于 35%/45% 时直接斩杀，击杀后立即追加一次普攻。",
      steps: [
        {
          effect: "damage",
          target: "lowest_hp",
          value: [10, 16],
          threshold: [0.35, 0.45],
          repeatOnKill: true,
        },
      ],
    },
  }),
  hero({
    id: "draven",
    dataDragonId: "Draven",
    name: "德莱文",
    quality: "blue",
    atk: 4,
    hp: 7,
    region: "noxus",
    professions: ["marksman"],
    growth: { atk: 1 },
    startMana: 20,
    maxMana: 70,
    skill: {
      id: "draven_whirling_death",
      name: "旋转飞斧",
      brief: "后排 2/3 段飞斧",
      desc: "向敌方后排连续投掷 2/3 次飞斧，每次造成攻击力 85%/100% 的伤害。",
      steps: [{ effect: "damage", target: "backmost", atkScale: [0.85, 1.0], hits: [2, 3] }],
    },
  }),
  hero({
    id: "katarina",
    dataDragonId: "Katarina",
    name: "卡特琳娜",
    quality: "purple",
    atk: 4,
    hp: 5,
    region: "noxus",
    professions: ["assassin"],
    startMana: 30,
    maxMana: 90,
    skill: {
      id: "katarina_death_lotus",
      name: "死亡莲华",
      brief: "随机后排多段",
      desc: "以随机后排目标为起点，旋转 3/5 段，每段造成 2/3 伤害。",
      steps: [
        {
          effect: "damage",
          target: "random_backline",
          value: [2, 3],
          hits: [3, 5],
          retargetEachHit: true,
        },
      ],
    },
  }),
  hero({
    id: "swain",
    dataDragonId: "Swain",
    name: "斯维因",
    quality: "orange",
    atk: 5,
    hp: 10,
    region: "noxus",
    professions: ["mage"],
    growth: { hp: 3 },    // 斯维因：法师靠吸血越打越肉
    startMana: 40,
    maxMana: 100,
    skill: {
      id: "swain_demonic_ascension",
      name: "恶魔升腾",
      brief: "全体伤害 + 吸血",
      desc: "对全体敌人造成 4/7 伤害，并按造成的实际生命伤害的 35%/50% 治疗自己。",
      steps: [
        { effect: "damage", target: "all_enemies", value: [4, 7] },
        { effect: "heal", target: "self", healRatioOfDamage: [0.35, 0.5] },
      ],
    },
  }),

  /* ── 艾欧尼亚 ── */
  hero({
    id: "shen",
    dataDragonId: "Shen",
    name: "慎",
    quality: "green",
    atk: 2,
    hp: 9,
    region: "ionia",
    professions: ["vanguard", "support"],
    startMana: 25,
    maxMana: 70,
    skill: {
      id: "shen_stand_united",
      name: "并肩作战",
      brief: "友方护盾 + 减伤",
      desc: "为生命最低的友方提供 8/14 护盾，并使其获得 1 次行动的 20%/30% 减伤。",
      steps: [
        { effect: "shield", target: "lowest_hp_ally", value: [8, 14] },
        {
          effect: "damage_reduction",
          target: "same_as_previous",
          ratio: [0.2, 0.3],
          duration: [1, 1],
        },
      ],
    },
  }),
  hero({
    id: "yasuo",
    dataDragonId: "Yasuo",
    name: "亚索",
    quality: "blue",
    atk: 4,
    hp: 7,
    region: "ionia",
    professions: ["warrior", "assassin"],
    startMana: 0,
    maxMana: 70,
    skill: {
      id: "yasuo_steel_tempest",
      name: "斩钢闪",
      brief: "三连击 + 第三击眩晕",
      desc: "对当前目标连击 3 次，每次造成攻击力 65%/80% 的伤害，第三击眩晕 1 次行动。",
      steps: [
        { effect: "damage", target: "current_target", atkScale: [0.65, 0.8], hits: [3, 3] },
        { effect: "stun", target: "same_as_previous", duration: [1, 1] },
      ],
    },
  }),
  hero({
    id: "ahri",
    dataDragonId: "Ahri",
    name: "阿狸",
    quality: "purple",
    atk: 4,
    hp: 5,
    region: "ionia",
    professions: ["mage"],
    startMana: 30,
    maxMana: 80,
    skill: {
      id: "ahri_charm",
      name: "欺诈宝珠",
      brief: "后排伤害 + 魅惑",
      desc: "对敌方后排造成 9/15 伤害并魅惑 1 次行动。",
      steps: [
        { effect: "damage", target: "backmost", value: [9, 15] },
        { effect: "charm", target: "same_as_previous", duration: [1, 1] },
      ],
    },
  }),
  hero({
    id: "irelia",
    dataDragonId: "Irelia",
    name: "艾瑞莉娅",
    quality: "orange",
    atk: 5,
    hp: 7,
    region: "ionia",
    professions: ["warrior", "assassin"],
    startMana: 20,
    maxMana: 90,
    skill: {
      id: "irelia_blade_surge",
      name: "无双挑战",
      brief: "打多名残血敌人",
      desc: "按当前生命从低到高选取至多 3/4 名不同敌人，各造成 5/8 伤害。",
      steps: [{ effect: "damage", target: "lowest_hp", value: [5, 8], maxTargets: [3, 4] }],
    },
  }),

  /* ── 皮尔特沃夫/祖安 ── */
  hero({
    id: "vi",
    dataDragonId: "Vi",
    name: "蔚",
    quality: "green",
    atk: 3,
    hp: 8,
    region: "piltover_zaun",
    professions: ["vanguard", "warrior"],
    startMana: 20,
    maxMana: 70,
    skill: {
      id: "vi_assault_and_battery",
      name: "天霸横空烈轰",
      brief: "破盾 + 伤害 + 眩晕",
      desc: "清除当前目标的全部护盾，造成 7/11 伤害并眩晕 1 次行动。",
      steps: [
        { effect: "break_shield", target: "frontmost" },
        { effect: "damage", target: "same_as_previous", value: [7, 11] },
        { effect: "stun", target: "same_as_previous", duration: [1, 1] },
      ],
    },
  }),
  hero({
    id: "jinx",
    dataDragonId: "Jinx",
    name: "金克丝",
    quality: "blue",
    atk: 4,
    hp: 6,
    region: "piltover_zaun",
    professions: ["marksman"],
    growth: { atk: 1 },   // 金克丝：射手越打越凶
    startMana: 20,
    maxMana: 80,
    skill: {
      id: "jinx_super_rocket",
      name: "超级死亡火箭",
      brief: "后排多段 + 击杀成长",
      desc: "攻击敌方后排 2/3 次；击杀后本场攻击力 +1/+2，并立即回复 20 法力。",
      steps: [{ effect: "damage", target: "backmost", atkScale: [1, 1], hits: [2, 3] }],
    },
    passives: [
      { trigger: "on_kill", effect: "attack_buff", value: [1, 2], desc: "击杀后攻击力永久提升" },
      { trigger: "on_kill", effect: "mana_gain", value: [20, 20], desc: "击杀后回复法力" },
    ],
  }),
  hero({
    id: "caitlyn",
    dataDragonId: "Caitlyn",
    name: "凯特琳",
    quality: "purple",
    atk: 5,
    hp: 5,
    region: "piltover_zaun",
    professions: ["marksman"],
    startMana: 30,
    maxMana: 90,
    skill: {
      id: "caitlyn_ace",
      name: "和平使者",
      brief: "狙击后排最低生命",
      desc: "狙击后排生命最低的敌人造成 13/22 伤害；后排为空时改为全场生命最低的敌人。",
      steps: [{ effect: "damage", target: "lowest_hp_backline", value: [13, 22] }],
    },
  }),
  hero({
    id: "ekko",
    dataDragonId: "Ekko",
    name: "艾克",
    quality: "orange",
    atk: 5,
    hp: 7,
    region: "piltover_zaun",
    professions: ["assassin", "mage"],
    startMana: 40,
    maxMana: 100,
    skill: {
      id: "ekko_chronobreak",
      name: "时空断裂",
      brief: "单体伤害 + 致命回溯",
      desc: "对当前目标造成 12/20 伤害，并使自己获得 1 次行动的 25% 减伤。",
      steps: [
        { effect: "damage", target: "current_target", value: [12, 20] },
        { effect: "damage_reduction", target: "self", ratio: [0.25, 0.25], duration: [1, 1] },
      ],
    },
    passives: [
      {
        trigger: "on_lethal_damage",
        effect: "revive_rewind",
        ratio: [0.35, 0.55],
        value: [30, 50],
        oncePerBattle: true,
        desc: "首次致命伤时回溯：恢复 35%/55% 生命、清除控制并回复法力（每场一次）",
      },
    ],
  }),

  /* ── 暗影岛 ── */
  hero({
    id: "hecarim",
    dataDragonId: "Hecarim",
    name: "赫卡里姆",
    quality: "green",
    atk: 3,
    hp: 9,
    region: "shadow_isles",
    professions: ["vanguard", "warrior"],
    startMana: 20,
    maxMana: 80,
    skill: {
      id: "hecarim_onslaught",
      name: "毁灭冲锋",
      brief: "同列伤害 + 自身护盾",
      desc: "冲撞当前目标及其同列敌人造成 6/10 伤害，自身按命中人数获得 1/2 护盾。",
      steps: [
        { effect: "damage", target: "same_column", value: [6, 10] },
        { effect: "shield", target: "self", shieldPerHit: [1, 2] },
      ],
    },
  }),
  hero({
    id: "kalista",
    dataDragonId: "Kalista",
    name: "卡莉丝塔",
    quality: "blue",
    atk: 4,
    hp: 6,
    region: "shadow_isles",
    professions: ["marksman"],
    startMana: 10,
    maxMana: 50,
    skill: {
      id: "kalista_rend",
      name: "撕裂",
      brief: "单体多段撕裂",
      desc: "对当前目标进行 4/6 段攻击，每段造成攻击力 50%/62% 的伤害；目标中途死亡则停止。",
      steps: [
        { effect: "damage", target: "current_target", atkScale: [0.5, 0.62], hits: [4, 6] },
      ],
    },
  }),
  hero({
    id: "thresh",
    dataDragonId: "Thresh",
    name: "锤石",
    quality: "purple",
    atk: 3,
    hp: 7,
    region: "shadow_isles",
    professions: ["support"],
    startMana: 30,
    maxMana: 80,
    skill: {
      id: "thresh_the_box",
      name: "幽冥监牢",
      brief: "友方护盾 + 后排眩晕",
      desc: "为生命最低的友方提供 8/13 护盾，并对敌方后排造成 4/7 伤害与 1 次行动眩晕。",
      steps: [
        { effect: "shield", target: "lowest_hp_ally", value: [8, 13] },
        { effect: "damage", target: "backmost", value: [4, 7] },
        { effect: "stun", target: "same_as_previous", duration: [1, 1] },
      ],
    },
  }),
  hero({
    id: "viego",
    dataDragonId: "Viego",
    name: "佛耶戈",
    quality: "orange",
    atk: 6,
    hp: 7,
    region: "shadow_isles",
    professions: ["assassin"],
    startMana: 20,
    maxMana: 90,
    skill: {
      id: "viego_blade_of_the_ruined_king",
      name: "破败王者之刃",
      brief: "残血斩杀 + 继承攻击",
      desc: "对生命最低的敌人造成 11/18 伤害；击杀后获得目标基础攻击力的 25%/40%，持续到战斗结束。",
      steps: [{ effect: "damage", target: "lowest_hp", value: [11, 18] }],
    },
    passives: [
      {
        trigger: "on_kill",
        effect: "steal_attack",
        ratio: [0.25, 0.4],
        desc: "击杀后继承目标部分基础攻击力",
      },
    ],
  }),
];

/* ══════════════ 英雄复制器（万能合成牌，不参与羁绊） ══════════════ */

export const DUPLICATOR_ID = "duplicator";

export const DUPLICATOR_CARD: CardConfig = {
  id: DUPLICATOR_ID,
  name: "英雄复制器",
  type: "duplicator",
  quality: "gold",
  atk: 0,
  hp: 0,
  price: PRICE.gold,
  region: null,
  professions: [],
  image: null,
  portrait: null,
  maxMana: 0,
  startMana: 0,
  skill: null,
  passives: [],
  skills: [],
  wildcard: "role",
};

/** 正式卡池：20 名英雄 + 英雄复制器 + 武器（商店只会刷出这里面的卡） */
export const CARD_POOL: CardConfig[] = [...HERO_CARDS, DUPLICATOR_CARD, ...WEAPON_CARDS];

/** 武器卡（图鉴与校验用） */
export { WEAPON_CARDS } from "./weapons";
export const ITEM_CARDS: CardConfig[] = WEAPON_CARDS;

/* ══════════════ 旧卡（不进商店，仅供旧测试/旧存档引用） ══════════════ */

function legacy(cfg: {
  id: string;
  name: string;
  quality: CardConfig["quality"];
  atk: number;
  hp: number;
  skills?: SkillConfig[];
  wildcard?: "role" | "weapon";
}): CardConfig {
  return {
    id: cfg.id,
    name: cfg.name,
    type: "role",
    quality: cfg.quality,
    atk: cfg.atk,
    hp: cfg.hp,
    price: PRICE[cfg.quality],
    region: null,
    professions: [],
    image: null,
    portrait: null,
    maxMana: 0,
    startMana: 0,
    skill: null,
    passives: [],
    skills: cfg.skills ?? [],
    ...(cfg.wildcard ? { wildcard: cfg.wildcard } : {}),
  };
}

export const LEGACY_CARDS: CardConfig[] = [
  legacy({ id: "loey", name: "洛伊", quality: "green", atk: 1, hp: 5 }),
  legacy({ id: "seth", name: "赛斯", quality: "green", atk: 2, hp: 3 }),
  legacy({ id: "swat", name: "斯沃特", quality: "green", atk: 2, hp: 4 }),
  legacy({
    id: "lan",
    name: "兰",
    quality: "blue",
    atk: 2,
    hp: 2,
    skills: [{ trigger: "turn_start", effect: "gain_exp", params: { n: 1 }, oncePerTurn: true }],
  }),
  legacy({
    id: "longye",
    name: "龙野",
    quality: "blue",
    atk: 2,
    hp: 3,
    skills: [{ trigger: "turn_start", effect: "free_refresh", params: { n: 1 }, oncePerTurn: true }],
  }),
  legacy({ id: "aogu", name: "傲骨", quality: "blue", atk: 3, hp: 3 }),
  legacy({ id: "daofeng", name: "刀锋", quality: "purple", atk: 4, hp: 6 }),
  legacy({ id: "zhujiuyin", name: "烛九阴", quality: "purple", atk: 4, hp: 8 }),
  legacy({ id: "taitan", name: "泰坦", quality: "orange", atk: 6, hp: 12 }),
  legacy({ id: "wumei", name: "妩媚妖姬", quality: "orange", atk: 5, hp: 8 }),
  legacy({ id: "fenliezhe", name: "分裂者", quality: "gold", atk: 0, hp: 0, wildcard: "role" }),
];

/* ══════════════ 索引 ══════════════ */

export const ALL_CARDS: CardConfig[] = [...CARD_POOL, ...LEGACY_CARDS];

const index = new Map<string, CardConfig>();
for (const card of ALL_CARDS) {
  if (index.has(card.id)) throw new Error(`config/cards: 卡牌 ID 重复 ${card.id}`);
  index.set(card.id, card);
}

export const CARD_BY_ID: ReadonlyMap<string, CardConfig> = index;

/** 该卡是否为万能牌；传 kind 时只匹配对应线路（role=英雄线，weapon=武器线） */
export function isWildcardCard(configId: string, kind?: "role" | "weapon"): boolean {
  const wild = CARD_BY_ID.get(configId)?.wildcard;
  if (!wild) return false;
  return kind ? wild === kind : true;
}

/** 只取英雄卡（羁绊统计 / 校验用） */
export function heroCardsOf(cards: readonly CardConfig[] = CARD_POOL): CardConfig[] {
  return cards.filter((c) => c.type === "hero");
}

/** 星级数值辅助（配置可读性）：[一星, 二星] */
export function stars(one: number, two: number): StarPair {
  return [one, two];
}
