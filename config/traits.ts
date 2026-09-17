/**
 * 羁绊配置（地区 + 职业）
 * 所有阈值与数值集中在此，战斗主循环与 UI 不得散落硬编码数字。
 * 阈值统一为 2 / 4 人两档；同一英雄每种羁绊只计 1 次（按不同 configId 去重）。
 */
import type { StarPair } from "../core/state";

/** 5 个地区 */
export type Region = "demacia" | "noxus" | "ionia" | "piltover_zaun" | "shadow_isles";
/** 6 个职业 */
export type Profession = "vanguard" | "warrior" | "mage" | "marksman" | "assassin" | "support";
export type TraitId = Region | Profession;
export type TraitKind = "region" | "profession";

/** 每个羁绊的数值旋钮（全部为数字，禁止把参数塞进无类型 Record） */
export interface TraitParamMap {
  /** 德玛西亚：开战护盾；首次破盾后加攻 */
  demacia: { startShield: StarPair; shieldBreakAtkBuff: number };
  /** 诺克萨斯：击杀成长；4 人击杀回血 */
  noxus: { killAtkBuff: StarPair; killHealRatio: number };
  /** 艾欧尼亚：初始法力；4 人施法回蓝 */
  ionia: { startMana: StarPair; castManaRefund: number };
  /** 皮尔特沃夫/祖安：确定性强化友军；4 人技能增幅 */
  piltover_zaun: { buffCount: StarPair; buffAtk: number; buffHp: number; skillAmp: number };
  /** 暗影岛：友方阵亡强化存活友军，单人有层数上限 */
  shadow_isles: { allyDeathAtkBuff: number; maxStacks: StarPair };
  /** 先锋：最大生命；4 人开战护盾 */
  vanguard: { maxHpRatio: StarPair; startShieldRatio: number };
  /** 战士：攻击力；4 人低血减伤 */
  warrior: { atkRatio: StarPair; lowHpThreshold: number; lowHpDamageReduction: number };
  /** 法师：技能增幅；4 人首次施法回蓝 */
  mage: { skillAmp: StarPair; firstCastManaRefund: number };
  /** 射手：每 N 次普攻追加一次攻击 */
  marksman: { extraAttackEvery: StarPair; extraAttackRatio: StarPair };
  /** 刺客：开战切后排，首次技能增幅 */
  assassin: { firstSkillAmp: StarPair };
  /** 辅助：治疗/护盾增幅；4 人增益复制给另一名残血友军 */
  support: { healShieldAmp: StarPair; copyBuffToExtraAlly: boolean };
}

export interface TraitConfigOf<K extends TraitId> {
  id: K;
  kind: TraitKind;
  name: string;
  /** 2 人 / 4 人 档位说明（UI 与文档共用） */
  desc: [string, string];
  /** 激活阈值 */
  thresholds: [number, number];
  params: TraitParamMap[K];
}

export type TraitConfig = { [K in TraitId]: TraitConfigOf<K> }[TraitId];

const THRESHOLDS: [number, number] = [2, 4];

export const TRAIT_LIST: TraitConfig[] = [
  {
    id: "demacia",
    kind: "region",
    name: "德玛西亚",
    desc: ["全队开战获得 3 点护盾", "改为 6 点护盾；首次破盾后攻击力 +2"],
    thresholds: THRESHOLDS,
    params: { startShield: [3, 6], shieldBreakAtkBuff: 2 },
  },
  {
    id: "noxus",
    kind: "region",
    name: "诺克萨斯",
    desc: ["击杀后本场攻击力 +1", "改为 +2，并回复 12% 最大生命"],
    thresholds: THRESHOLDS,
    params: { killAtkBuff: [1, 2], killHealRatio: 0.12 },
  },
  {
    id: "ionia",
    kind: "region",
    name: "艾欧尼亚",
    desc: ["全队初始法力 +20", "改为 +35；每次施法返还 15 法力"],
    thresholds: THRESHOLDS,
    params: { startMana: [20, 35], castManaRefund: 15 },
  },
  {
    id: "piltover_zaun",
    kind: "region",
    name: "皮城祖安",
    desc: ["确定性强化 1 名友军（攻 +2 / 生命 +2）", "强化 2 名，技能效果倍率 +15%"],
    thresholds: THRESHOLDS,
    params: { buffCount: [1, 2], buffAtk: 2, buffHp: 2, skillAmp: 0.15 },
  },
  {
    id: "shadow_isles",
    kind: "region",
    name: "暗影岛",
    desc: ["首名友方阵亡后，存活友军攻击力 +1", "每次阵亡都触发，单个单位最多 3 层"],
    thresholds: THRESHOLDS,
    params: { allyDeathAtkBuff: 1, maxStacks: [1, 3] },
  },

  {
    id: "vanguard",
    kind: "profession",
    name: "先锋",
    desc: ["最大生命 +15%", "最大生命 +30%，开战获得 10% 最大生命护盾"],
    thresholds: THRESHOLDS,
    params: { maxHpRatio: [0.15, 0.3], startShieldRatio: 0.1 },
  },
  {
    id: "warrior",
    kind: "profession",
    name: "战士",
    desc: ["攻击力 +15%", "攻击力 +30%；低于 40% 生命时减伤 20%"],
    thresholds: THRESHOLDS,
    params: { atkRatio: [0.15, 0.3], lowHpThreshold: 0.4, lowHpDamageReduction: 0.2 },
  },
  {
    id: "mage",
    kind: "profession",
    name: "法师",
    desc: ["技能伤害/治疗/护盾 +15%", "改为 +30%；首次施法返还 15 法力"],
    thresholds: THRESHOLDS,
    params: { skillAmp: [0.15, 0.3], firstCastManaRefund: 15 },
  },
  {
    id: "marksman",
    kind: "profession",
    name: "射手",
    desc: ["每第 3 次普攻追加一次 75% 攻击", "每第 2 次普攻追加一次 90% 攻击"],
    thresholds: THRESHOLDS,
    params: { extraAttackEvery: [3, 2], extraAttackRatio: [0.75, 0.9] },
  },
  {
    id: "assassin",
    kind: "profession",
    name: "刺客",
    desc: ["开战锁定敌方后排，首次技能 +15%", "首次技能 +35%；后排为空才回退前排"],
    thresholds: THRESHOLDS,
    params: { firstSkillAmp: [0.15, 0.35] },
  },
  {
    id: "support",
    kind: "profession",
    name: "辅助",
    desc: ["治疗和护盾 +20%", "改为 +40%；单体友方增益复制给另一名残血友军"],
    thresholds: THRESHOLDS,
    params: { healShieldAmp: [0.2, 0.4], copyBuffToExtraAlly: true },
  },
];

export const REGIONS: Region[] = ["demacia", "noxus", "ionia", "piltover_zaun", "shadow_isles"];
export const PROFESSIONS: Profession[] = ["vanguard", "warrior", "mage", "marksman", "assassin", "support"];

export const TRAIT_BY_ID: ReadonlyMap<TraitId, TraitConfig> = new Map(
  TRAIT_LIST.map((t) => [t.id, t]),
);

export function traitName(id: TraitId): string {
  return TRAIT_BY_ID.get(id)?.name ?? id;
}

/** 人数 → 档位下标（-1 = 未激活，0 = 2 人档，1 = 4 人档） */
export function tierIndexFor(id: TraitId, count: number): number {
  const cfg = TRAIT_BY_ID.get(id);
  if (!cfg) return -1;
  if (count >= cfg.thresholds[1]) return 1;
  if (count >= cfg.thresholds[0]) return 0;
  return -1;
}

/** 取该羁绊在指定档位下的 2 人/4 人描述 */
export function traitDesc(id: TraitId, tier: number): string {
  const cfg = TRAIT_BY_ID.get(id);
  if (!cfg || tier < 0) return "";
  return cfg.desc[tier] ?? "";
}
