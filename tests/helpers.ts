/**
 * 测试辅助：构建对局状态、放置卡牌
 */
import { createGame, createCardInstance, type BattleEvent, type CardInstance, type GameState, type PlayerState } from "../core/state";
import { createRng, type Rng } from "../core/rng";
import { createBattleContext } from "../core/battle";

export interface TestCtx {
  state: GameState;
  rng: Rng;
  p: PlayerState;
}

export function makeCtx(seed = 12345): TestCtx {
  const state = createGame(seed);
  const rng = createRng(seed);
  return { state, rng, p: state.players[0]! };
}

/** 给玩家手牌加一张卡（返回实例） */
export function giveHand(state: GameState, p: PlayerState, configId: string): CardInstance {
  const c = createCardInstance(state, configId);
  p.hand.push(c);
  return c;
}

/** 把一张卡放到场上指定位置（1~6） */
export function place(state: GameState, p: PlayerState, configId: string, pos: number): CardInstance {
  const c = createCardInstance(state, configId);
  c.position = pos;
  p.board[pos - 1] = c;
  return c;
}

/** 手牌中找指定 configId 的卡 */
export function handOf(p: PlayerState, configId: string): CardInstance[] {
  return p.hand.filter((c) => c.configId === configId);
}

/** 场上非空卡列表（按位置 1→6） */
export function boardCards(p: PlayerState): CardInstance[] {
  return p.board.filter((c): c is CardInstance => c !== null);
}

/* ══════════════ 战斗测试辅助 ══════════════ */

/** 建好战斗上下文（未开战），可注入血量/法力后调用 runBattle */
export function battleCtx(state: GameState, aId = 0, bId = 1) {
  return createBattleContext(state, aId, bId);
}

/** 把某单位设为满法力（测试技能时用） */
export function fillMana(ctx: ReturnType<typeof battleCtx>, uid: number): void {
  const unit = ctx.byUid.get(uid);
  if (!unit) throw new Error(`fillMana: 找不到单位 ${uid}`);
  unit.mana = unit.maxMana;
}

/** 取指定类型的事件 */
export function eventsOfType<T extends BattleEvent["type"]>(
  events: BattleEvent[],
  type: T,
): Extract<BattleEvent, { type: T }>[] {
  return events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);
}

/** 某单位累计受到的实际生命伤害（不含被护盾吸收） */
export function hpDamageTakenTo(events: BattleEvent[], uid: number): number {
  return events
    .filter((e): e is Extract<BattleEvent, { type: "DAMAGE" }> => e.type === "DAMAGE" && e.target === uid)
    .reduce((s, e) => s + (e.amount - e.absorbed), 0);
}

/** 汇总某单位受到的伤害事件（含被吸收） */
export function damageEventsTo(events: BattleEvent[], uid: number) {
  return events.filter((e): e is Extract<BattleEvent, { type: "DAMAGE" }> => e.type === "DAMAGE" && e.target === uid);
}

/** 给单位加上开战护盾（测试破盾/护盾吸收用） */
export function grantShield(
  ctx: ReturnType<typeof battleCtx>,
  uid: number,
  amount: number,
): void {
  const unit = ctx.byUid.get(uid);
  if (!unit) throw new Error(`grantShield: 找不到单位 ${uid}`);
  unit.shield += amount;
}
