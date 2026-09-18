/**
 * 全局状态类型与工厂（地基原则 2.1：只存当前态）
 * 规则版本号 version 用于将来规则变更时兼容旧回放
 */
import type { CardConfig } from "../config/cards";
import { CARD_BY_ID, HERO_CARDS, WEAPON_CARDS } from "../config/cards";
import { shopConfig } from "../config/shop";
import { damageConfig } from "../config/damage";
import { gameConfig } from "../config/game";
import type { MapId } from "../config/maps";
import { createRng, pick } from "./rng";

export type Quality = "green" | "blue" | "purple" | "orange" | "gold";
export type Phase = "shop" | "pair" | "battle" | "damage" | "ended";

/* ══════════════ 技能 / 效果 = 数据（词条扩展点） ══════════════ */

/** 星级数值对：[1 星, 2 星]。2 星按配置取值，不做整体翻倍 */
export type StarPair = readonly [number, number];

/** 敌方目标规则（core/targeting.ts 统一实现） */
export type EnemyTargetRule =
  | "frontmost" // 最前排存活单位（1→6 顺序中的第一个）
  | "backmost" // 最后排存活单位（刺客/射手切后排）
  | "lowest_hp" // 生命最低的敌人
  | "lowest_hp_backline" // 后排生命最低；后排为空回退全场最低
  | "current_target" // 本次行动已锁定的目标
  | "same_column" // 当前目标所在整列敌人
  | "all_enemies" // 全体敌人
  | "random_enemy" // 随机敌人（消耗战斗 RNG）
  | "random_backline"; // 随机后排敌人（消耗战斗 RNG），后排为空回退前排

/** 友方目标规则 */
export type AllyTargetRule = "self" | "lowest_hp_ally" | "all_allies" | "random_ally";

/** same_as_previous：复用上一个步骤选中的目标（连招类技能） */
export type TargetRule = EnemyTargetRule | AllyTargetRule | "same_as_previous";

/** 通用效果名（core/effects.ts 注册实现；英雄技能尽量只由这些组合出来） */
export type SkillEffectName =
  | "damage" // 伤害（可多段、可斩杀阈值）
  | "heal" // 治疗
  | "shield" // 护盾
  | "stun" // 眩晕（跳过 N 次行动）
  | "charm" // 魅惑（本轮实现为独立状态名的眩晕）
  | "attack_buff" // 攻击力增益
  | "damage_reduction" // 伤害减免
  | "break_shield" // 破盾
  | "mana_gain" // 回蓝
  | "execute"; // 斩杀（目标生命低于阈值直接击杀）

/**
 * 一个技能步骤：目标规则 + 效果 + 星级数值。
 * 数值来源优先级：value（固定）+ atkScale（施法者攻击力倍率）。
 */
export interface SkillStep {
  effect: SkillEffectName;
  target: TargetRule;
  /** 固定数值（按星级） */
  value?: StarPair;
  /** 施法者攻击力倍率（按星级），与 value 相加 */
  atkScale?: StarPair;
  /** 段数（按星级），默认 1。多段中途目标死亡则停止剩余段数 */
  hits?: StarPair;
  /** 状态持续的行动次数（按星级） */
  duration?: StarPair;
  /** 多目标上限（按星级），默认 1 */
  maxTargets?: StarPair;
  /** 斩杀阈值：目标当前生命 / 最大生命 ≤ 阈值 → 直接击杀（按星级） */
  threshold?: StarPair;
  /** 比例类数值（减伤比例 / 攻击力转化比例，按星级） */
  ratio?: StarPair;
  /** 治疗量 = 本步骤实际造成的生命伤害 × 该比例（按星级） */
  healRatioOfDamage?: StarPair;
  /** 每命中一个目标，施法者自身获得该数值护盾（按星级） */
  shieldPerHit?: StarPair;
  /** 每一段都重新选取目标（卡特琳娜随机起点） */
  retargetEachHit?: boolean;
  /** 击杀后立刻追加一次普攻，每次施法最多触发一次（德莱厄斯） */
  repeatOnKill?: boolean;
}

/** 主动技能：英雄满法力后施放 */
export interface ActiveSkillConfig {
  id: string;
  name: string;
  /** 一句话简介（卡面/商店用，尽量短） */
  brief?: string;
  /** 完整说明（详情弹窗用） */
  desc: string;
  steps: SkillStep[];
}

/** 战斗被动触发器 */
export type PassiveTrigger = "on_kill" | "on_lethal_damage" | "on_skill_cast" | "on_battle_start";

/** 战斗被动效果名 */
export type PassiveEffectName =
  | "attack_buff" // 本场战斗永久加攻
  | "mana_gain" // 回蓝
  | "revive_rewind" // 致命伤回溯（艾克）
  | "steal_attack" // 击杀后继承目标部分基础攻击力（佛耶戈）
  | "heal"
  | "shield";

export interface PassiveConfig {
  trigger: PassiveTrigger;
  effect: PassiveEffectName;
  value?: StarPair;
  ratio?: StarPair;
  /** 每场战斗只触发一次（艾克） */
  oncePerBattle?: boolean;
  /** 最大叠加层数 */
  maxStacks?: number;
  desc?: string;
}

/** 商店阶段被动（旧体系兼容：兰 +经验 / 龙野 +免费刷新） */
export interface SkillConfig {
  trigger:
    | "turn_start"
    | "on_attack"
    | "on_death"
    | "on_kill"
    | "on_battle_start"
    | "on_hurt"
    | "on_shop_refresh";
  effect: string;
  params: Record<string, number>;
  oncePerTurn?: boolean;
}

/* ══════════════ 局内状态 ══════════════ */

/** 装备实例：武器卡装备到英雄身上之后的形态（数值固定，跟随英雄进战斗） */
export interface EquipInstance {
  uid: number;
  configId: string;
  level: 1 | 2;
  atk: number;
  hp: number;
}

/** 每名英雄的武器槽数量 */
export const EQUIP_SLOTS = 2;

/** 卡牌实例：atk/hp 只存**英雄自身**的当前值（金卡=三张之和，不可从配置推导）；装备加成走 equips */
export interface CardInstance {
  uid: number;
  configId: string;
  level: 1 | 2; // 1=普通 2=金卡（最高级，不可再合成）
  atk: number;
  hp: number;
  position: number | null; // 场上位置 1~6（前3后3），null=在手牌
  isFreeRefreshUsed: boolean; // 龙野类每回合状态位
  /** 已装备的武器（每名英雄 EQUIP_SLOTS 件；武器加成不计入 atk/hp，用 totalAtk/totalHp 读取） */
  equips: EquipInstance[];
  /** 成长属性累计值（只有配置了 growth 的英雄才会涨；上阵期间每回合结算） */
  growthAtk: number;
  growthHp: number;
}

/** 装备加成合计（攻击） */
export function equipAtk(card: CardInstance): number {
  let sum = 0;
  for (const e of card.equips) sum += e.atk;
  return sum;
}

/** 装备加成合计（生命） */
export function equipHp(card: CardInstance): number {
  let sum = 0;
  for (const e of card.equips) sum += e.hp;
  return sum;
}

/** 含装备与成长加成的攻击力 */
export function totalAtk(card: CardInstance): number {
  return card.atk + card.growthAtk + equipAtk(card);
}

/** 含装备与成长加成的生命上限 */
export function totalHp(card: CardInstance): number {
  return card.hp + card.growthHp + equipHp(card);
}

/** 装备槽是否还有空位 */
export function hasFreeEquipSlot(card: CardInstance): boolean {
  return card.equips.length < EQUIP_SLOTS;
}

export interface PlayerState {
  id: number;
  isHuman: boolean;
  hp: number; // 初始 30
  gold: number;
  exp: number; // 经验（升级消耗）
  shopLevel: number; // 1~5
  hand: CardInstance[]; // 手牌（上限 15）
  board: (CardInstance | null)[]; // 长度 6
  /** 武器库存（装备前放在这里，不占手牌也不占上阵位） */
  weapons: EquipInstance[];
  shop: (string | null)[]; // 当前商店 3 个槽位（configId，购买后置 null）
  freeRefresh: number; // 免费刷新次数（龙野给 1，金龙野给 2；每回合清零不累积）
  shopDone: boolean; // 本回合商店阶段是否已结束
  eliminated: boolean;
  rank: number | null; // 名次（出局时记录）
}

export interface GameState {
  round: number; // 当前回合数
  phase: Phase;
  players: PlayerState[];
  seed: number;
  /** 本局地图（匹配阶段投票决定；null = 无地图加成） */
  mapId: MapId | null;
  nextUid: number; // 卡牌实例 UID 分配器
  lastOpponent: (number | null)[]; // 各玩家上一回合对手（配对时避免重复；轮空为 null）
  pendingPairings: Pairing[] | null; // 准备阶段产出的配对（战斗结算前有效）
  battleLog: BattleEvent[]; // 战斗事件日志（渲染层/回放消费）
  version: string; // 规则版本号
}

export const RULES_VERSION = "0.7";

/** 一轮对战的配对（b=null 为轮空） */
export interface Pairing {
  a: number; // 先手方
  b: number | null; // 后手方（null=轮空）
}

/* ══════════════ 战斗快照与事件 ══════════════ */

/** 战斗状态（眩晕/魅惑/减伤）；duration 以"该单位自己的行动次数"计 */
export type StatusId = "stun" | "charm" | "damage_reduction";

export interface StatusInstance {
  id: StatusId;
  duration: number;
  value: number; // 减伤比例等；无值状态为 0
  source: number; // 施加者 uid
}

/** 战斗开局时双方棋盘快照（战斗展示/回放用；战斗临时属性只存在于此） */
export interface BattleUnitSnapshot {
  uid: number;
  owner: number;
  configId: string;
  level: 1 | 2;
  atk: number;
  hp: number;
  maxHp: number;
  position: number;
  mana: number;
  maxMana: number;
  startMana: number;
  shield: number;
  statuses: StatusInstance[];
  attackCount: number;
  castCount: number;
  /** 已装备的武器快照（用于战斗界面展示武器条） */
  equips?: { configId: string; level: 1 | 2; atk: number; hp: number }[];
}

export type BattleEvent =
  | {
      type: "BATTLE_START";
      a: number;
      b: number;
      boards: { a: BattleUnitSnapshot[]; b: BattleUnitSnapshot[] };
    }
  | { type: "ATTACK"; from: number; to: number; dmg: number }
  | { type: "DEATH"; who: number; killer: number | null }
  | { type: "COMBINE"; cardUid: number; configId: string } // 三合一（购买阶段事件）
  | { type: "SKILL_CAST"; caster: number; skillId: string; skillName: string; targets: number[] }
  | {
      type: "DAMAGE";
      source: number | null;
      target: number;
      amount: number;
      absorbed: number;
      remainingHp: number;
    }
  | { type: "HEAL"; source: number; target: number; amount: number; remainingHp: number }
  | { type: "SHIELD_GAIN"; source: number; target: number; amount: number; totalShield: number }
  | { type: "SHIELD_BREAK"; source: number | null; target: number; amount: number }
  | { type: "STATUS_APPLY"; source: number; target: number; status: StatusId; duration: number }
  | { type: "STATUS_REMOVE"; target: number; status: StatusId }
  | { type: "MANA_CHANGE"; who: number; before: number; after: number; reason: string }
  | { type: "JUMP"; who: number; toRow: "front" | "back" }
  | { type: "REVIVE"; who: number; hp: number }
  | { type: "TRAIT_TRIGGER"; owner: number; trait: string; tier: number; targets: number[] }
  | { type: "MAP_EFFECT"; mapId: string; owner: number; targets: number[] }
  | {
      type: "BATTLE_END";
      winner: number | null;
      survivors: { player: number; cardUid: number; hp: number }[];
    };

export function createGame(seed: number, mapId: MapId | null = null, opts: CreateGameOptions = {}): GameState {
  const players: PlayerState[] = Array.from({ length: gameConfig.playerCount }, (_, i) => ({
    id: i,
    isHuman: i === 0,
    hp: damageConfig.initialHp,
    gold: 0,
    exp: 0,
    shopLevel: 1,
    hand: [],
    board: Array<CardInstance | null>(shopConfig.boardSize).fill(null),
    weapons: [],
    shop: Array<string | null>(shopConfig.shopSize).fill(null),
    freeRefresh: 0,
    shopDone: false,
    eliminated: false,
    rank: null,
  }));

  const state: GameState = {
    round: 1,
    phase: "shop",
    players,
    seed,
    mapId,
    nextUid: 1,
    lastOpponent: Array<number | null>(gameConfig.playerCount).fill(null),
    pendingPairings: null,
    battleLog: [],
    version: RULES_VERSION,
  };
  if (opts.startingLoadout !== false) grantStartingLoadout(state);
  return state;
}

export interface CreateGameOptions {
  /**
   * 是否发放开局赠礼（1 个绿色英雄直接上阵 + 1 件绿色武器进武器库）。
   * 默认 true —— 真实对局就是这样开局的。
   * 只想测某个机制、需要干净棋盘的测试可以传 false。
   */
  startingLoadout?: boolean;
}

/**
 * 开局赠礼：每人 1 个绿色英雄（**直接上阵**，省得新手不知道要拖） + 1 件绿色武器（放武器库，引导拖拽装备）。
 * 用独立派生的 RNG，**不动主 RNG 序列**，所以不会改变已有 seed 的回放结果。
 */
function grantStartingLoadout(state: GameState): void {
  const heroes = HERO_CARDS.filter((c) => c.quality === shopConfig.startingHeroQuality);
  const weapons = WEAPON_CARDS.filter((c) => c.quality === shopConfig.startingWeaponQuality);
  if (heroes.length === 0 || weapons.length === 0) return;

  const rng = createRng((state.seed ^ 0x5eed1a7e) >>> 0);
  for (const p of state.players) {
    const hero = createCardInstance(state, pick(rng, heroes).id);
    hero.position = 1;
    p.board[0] = hero;
    p.weapons.push(createEquipInstance(state, pick(rng, weapons).id));
  }
}

/** 创建卡牌实例（从 state.nextUid 分配 UID） */
export function createCardInstance(state: GameState, configId: string, level: 1 | 2 = 1): CardInstance {
  const config: CardConfig | undefined = CARD_BY_ID.get(configId);
  if (!config) throw new Error(`createCardInstance: 未知卡牌 ${configId}`);
  return {
    uid: state.nextUid++,
    configId,
    level,
    atk: config.atk,
    hp: config.hp,
    position: null,
    isFreeRefreshUsed: false,
    equips: [],
    growthAtk: 0,
    growthHp: 0,
  };
}

/** 创建装备实例（武器卡 → 装备形态） */
export function createEquipInstance(state: GameState, configId: string, level: 1 | 2 = 1): EquipInstance {
  const config = CARD_BY_ID.get(configId);
  if (!config) throw new Error(`createEquipInstance: 未知武器 ${configId}`);
  if (config.type !== "weapon") throw new Error(`createEquipInstance: ${configId} 不是武器`);
  return { uid: state.nextUid++, configId, level, atk: config.atk, hp: config.hp };
}

/** 场上存活卡列表（按位置 1→6 顺序，含装备加成后的血量） */
export function aliveBoardCards(player: PlayerState): CardInstance[] {
  return player.board.filter((c): c is CardInstance => c !== null && totalHp(c) > 0);
}

/** 场上存活卡剩余血量之和（伤害公式输入，含装备加成） */
export function survivingHpSum(player: PlayerState): number {
  return aliveBoardCards(player).reduce((s, c) => s + totalHp(c), 0);
}

/** 存活玩家列表 */
export function alivePlayers(state: GameState): PlayerState[] {
  return state.players.filter((p) => !p.eliminated);
}
