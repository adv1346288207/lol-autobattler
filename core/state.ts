/**
 * 全局状态类型与工厂（地基原则 2.1：只存当前态）
 * 规则版本号 version 用于将来规则变更时兼容旧回放
 */
import type { CardConfig } from "../config/cards";
import { CARD_BY_ID } from "../config/cards";
import { shopConfig } from "../config/shop";
import { damageConfig } from "../config/damage";
import { gameConfig } from "../config/game";

export type Quality = "green" | "blue" | "purple" | "orange" | "gold";
export type Phase = "shop" | "pair" | "battle" | "damage" | "ended";

/** 技能 = 数据（词条扩展点）：trigger 挂事件总线，effect 查效果注册表 */
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

/** 卡牌实例：atk/hp 只存当前值（金卡=三张之和，不可从配置推导） */
export interface CardInstance {
  uid: number;
  configId: string;
  level: 1 | 2; // 1=普通 2=金卡（最高级，不可再合成）
  atk: number;
  hp: number;
  position: number | null; // 场上位置 1~6（前3后3），null=在手牌
  isFreeRefreshUsed: boolean; // 龙野类每回合状态位
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
  nextUid: number; // 卡牌实例 UID 分配器
  lastOpponent: (number | null)[]; // 各玩家上一回合对手（配对时避免重复；轮空为 null）
  battleLog: BattleEvent[]; // 战斗事件日志（渲染层/回放消费）
  version: string; // 规则版本号
}

export const RULES_VERSION = "0.4";

export type BattleEvent =
  | { type: "BATTLE_START"; a: number; b: number }
  | { type: "ATTACK"; from: number; to: number; dmg: number }
  | { type: "DEATH"; who: number }
  | { type: "COMBINE"; cardUid: number; configId: string } // 三合一（购买阶段事件）
  | { type: "BATTLE_END"; winner: number | null; survivors: { player: number; cardUid: number; hp: number }[] };

export function createGame(seed: number): GameState {
  const players: PlayerState[] = Array.from({ length: gameConfig.playerCount }, (_, i) => ({
    id: i,
    isHuman: i === 0,
    hp: damageConfig.initialHp,
    gold: 0,
    exp: 0,
    shopLevel: 1,
    hand: [],
    board: Array<CardInstance | null>(shopConfig.boardSize).fill(null),
    shop: Array<string | null>(shopConfig.shopSize).fill(null),
    freeRefresh: 0,
    shopDone: false,
    eliminated: false,
    rank: null,
  }));

  return {
    round: 1,
    phase: "shop",
    players,
    seed,
    nextUid: 1,
    lastOpponent: Array<number | null>(gameConfig.playerCount).fill(null),
    battleLog: [],
    version: RULES_VERSION,
  };
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
  };
}

/** 场上存活卡列表（按位置 1→6 顺序） */
export function aliveBoardCards(player: PlayerState): CardInstance[] {
  return player.board.filter((c): c is CardInstance => c !== null && c.hp > 0);
}

/** 场上存活卡剩余血量之和（伤害公式输入） */
export function survivingHpSum(player: PlayerState): number {
  return aliveBoardCards(player).reduce((s, c) => s + c.hp, 0);
}

/** 存活玩家列表 */
export function alivePlayers(state: GameState): PlayerState[] {
  return state.players.filter((p) => !p.eliminated);
}
