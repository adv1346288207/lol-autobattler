/**
 * Web 对局会话（浏览器端控制器）
 * 玩家 0 = 人类；玩家 1~7 = 独立随机源 AI（与对局 RNG 分离）
 * 纯逻辑、零 DOM 依赖 → 可被 vitest 直接测试
 */
import { createGame, type BattleEvent, type GameState, type PlayerState } from "../core/state";
import { createRng, type Rng } from "../core/rng";
import { beginRound, resolveRound } from "../core/phase";
import { applyAction, type Action } from "../core/actions";
import { runBotTurn, createBot, type Bot } from "../bot/random";

export class GameSession {
  readonly seed: number;
  readonly state: GameState;
  private readonly rng: Rng;
  private readonly bots: Map<number, Bot>;
  private lastBattleLog: BattleEvent[] = [];

  constructor(seed: number) {
    this.seed = seed;
    this.state = createGame(seed);
    this.rng = createRng(seed);
    this.bots = new Map(
      this.state.players.filter((p) => p.id !== 0).map((p) => [p.id, createBot(seed, p.id)]),
    );
    beginRound(this.state, this.rng);
  }

  get player(): PlayerState {
    return this.state.players[0]!;
  }

  get isOver(): boolean {
    return this.state.phase === "ended";
  }

  /** 最近一回合的战斗日志（渲染层消费） */
  get battleLog(): BattleEvent[] {
    return this.lastBattleLog;
  }

  /** 玩家操作（buy/sell/refresh/upgradeShop/buyExp/move）；非法操作抛错，由 UI 提示 */
  act(action: Action): BattleEvent[] {
    return applyAction(this.state, this.rng, action);
  }

  /**
   * 结束回合：玩家 endShop → 7 个 AI 行动 → 配对/战斗/结算 → 下一回合
   * 返回本回合战斗日志；对局结束时返回终局日志
   * 若玩家 0 已被淘汰：自动快进到终局（观战），返回剩余所有回合的日志
   */
  endTurn(): BattleEvent[] {
    let log: BattleEvent[] = [];
    let guard = 0;
    for (;;) {
      if (guard++ >= 200) throw new Error("endTurn: 对局未在保护次数内结束");
      const p0 = this.state.players[0]!;
      if (this.state.phase === "shop" && !p0.eliminated && !p0.shopDone) {
        applyAction(this.state, this.rng, { type: "endShop", player: 0 });
      }
      for (const p of this.state.players) {
        if (!p.eliminated && !p.shopDone) {
          runBotTurn(this.state, this.rng, p.id, this.bots.get(p.id)!);
        }
      }
      log = log.concat(resolveRound(this.state, this.rng));
      if (this.state.phase === "ended") break;
      if (!p0.eliminated) break; // 人类存活：一回合一轮，等待下一次交互
    }
    this.lastBattleLog = log;
    return log;
  }

  /** 终局名次表（按名次排序） */
  finalRanking(): PlayerState[] {
    return [...this.state.players].sort((a, b) => (a.rank ?? 9) - (b.rank ?? 9));
  }
}
