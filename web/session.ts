/**
 * Web 对局会话（浏览器端控制器）
 * 玩家 0 = 人类；玩家 1~7 = 独立随机源 AI（与对局 RNG 分离）
 * 纯逻辑、零 DOM 依赖 → 可被 vitest 直接测试
 */
import { createGame, type BattleEvent, type GameState, type PlayerState } from "../core/state";
import { createRng, type Rng } from "../core/rng";
import { beginRound, prepareBattle, resolveBattle } from "../core/phase";
import { applyAction, type Action } from "../core/actions";
import { runBotTurn, createBot, type Bot } from "../bot/random";
import { pickMapForSeed, tallyMapVotes, type MapId, type MapVoteResult } from "../config/maps";

export interface TurnPreview {
  /** 本回合对手（null=轮空） */
  opponentId: number | null;
  /** 玩家 0 是否先手（轮空时无意义） */
  amFirst: boolean;
}

export class GameSession {
  readonly seed: number;
  readonly state: GameState;
  private readonly rng: Rng;
  private readonly bots: Map<number, Bot>;
  private lastBattleLog: BattleEvent[] = [];

  constructor(seed: number, mapId: MapId | null = pickMapForSeed(seed)) {
    this.seed = seed;
    this.state = createGame(seed, mapId);
    this.rng = createRng(seed);
    this.bots = new Map(
      this.state.players.filter((p) => p.id !== 0).map((p) => [p.id, createBot(seed, p.id)]),
    );
    beginRound(this.state, this.rng);
  }

  /** 开局地图投票（玩家 0 的票由调用方给出，其余 AI 由 seed 派生） */
  static voteMap(seed: number, playerVote: MapId | null): MapVoteResult {
    return tallyMapVotes(seed, playerVote);
  }

  get player(): PlayerState {
    return this.state.players[0]!;
  }

  get isOver(): boolean {
    return this.state.phase === "ended";
  }

  /** 最近一次战斗的战斗日志（渲染层消费） */
  get battleLog(): BattleEvent[] {
    return this.lastBattleLog;
  }

  /** 玩家操作（buy/sell/refresh/upgradeShop/move）；非法操作抛错，由 UI 提示 */
  act(action: Action): BattleEvent[] {
    return applyAction(this.state, this.rng, action);
  }

  /**
   * 准备阶段：玩家 endShop → 7 个 AI 行动 → 配对
   * 在开战前即可知道"对手是谁 + 谁先手"（a=先手）
   */
  prepareTurn(): TurnPreview {
    const p0 = this.state.players[0]!;
    if (this.state.phase === "shop" && !p0.eliminated && !p0.shopDone) {
      applyAction(this.state, this.rng, { type: "endShop", player: 0 });
    }
    for (const p of this.state.players) {
      if (!p.eliminated && !p.shopDone) {
        runBotTurn(this.state, this.rng, p.id, this.bots.get(p.id)!);
      }
    }
    const pairs = prepareBattle(this.state, this.rng);
    const mine = pairs.find((p) => p.a === 0 || p.b === 0);
    if (!mine || mine.b === null) return { opponentId: null, amFirst: false };
    return { opponentId: mine.a === 0 ? mine.b : mine.a, amFirst: mine.a === 0 };
  }

  /** 战斗阶段：按准备好的配对结算，返回本回合全部战斗日志 */
  fightTurn(): BattleEvent[] {
    const log = resolveBattle(this.state, this.rng);
    this.lastBattleLog = log;
    return log;
  }

  /** 组合流程（测试/AI 驱动用）：准备 + 战斗；玩家 0 出局后自动快进到终局 */
  endTurn(): BattleEvent[] {
    let log: BattleEvent[] = [];
    let guard = 0;
    for (;;) {
      if (guard++ >= 200) throw new Error("endTurn: 对局未在保护次数内结束");
      this.prepareTurn();
      log = log.concat(this.fightTurn());
      if (this.state.phase === "ended") break;
      if (!this.state.players[0]!.eliminated) break; // 人类存活：一回合一轮，等待下一次交互
    }
    this.lastBattleLog = log;
    return log;
  }

  /** 终局名次表（按名次排序） */
  finalRanking(): PlayerState[] {
    return [...this.state.players].sort((a, b) => (a.rank ?? 9) - (b.rank ?? 9));
  }
}
