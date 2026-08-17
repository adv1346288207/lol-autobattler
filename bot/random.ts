/**
 * 呆 AI（RandomBot，M2/M4）
 * 接口与人类玩家完全一致（逐条返回 Action）——将来替换为网络玩家零改动
 * 策略：经验够就升级 → 优先买凑三合一的卡 → 买得起的卡 → 10% 刷新 → 上阵 → 结束
 *
 * ⚠️ AI 使用独立随机源（由 seed+playerId 派生），不消耗对局 RNG：
 *    保证回放时 Action 日志可原样重放、AI 决策不扰动对局随机流（联机同理）
 */
import type { Action } from "../core/actions";
import { applyAction } from "../core/actions";
import type { GameState, PlayerState } from "../core/state";
import { createRng, type Rng } from "../core/rng";
import { CARD_BY_ID } from "../config/cards";
import { shopConfig } from "../config/shop";
import { expToUpgrade } from "../config/economy";

export interface Bot {
  decide(state: GameState, playerId: number): Action;
}

function copyCount(p: PlayerState, configId: string): number {
  const onHand = p.hand.filter((c) => c.configId === configId).length;
  const onBoard = p.board.filter((c) => c !== null && c.configId === configId).length;
  return onHand + onBoard;
}

function canAfford(p: PlayerState, configId: string): boolean {
  const config = CARD_BY_ID.get(configId);
  if (!config) return false;
  return p.gold >= config.price && p.hand.length < shopConfig.handLimit;
}

/** 创建一个带独立随机源的 AI（每个玩家一个实例） */
export function createBot(seed: number, playerId: number): Bot {
  const rng: Rng = createRng((seed + playerId * 0x9e3779b9) >>> 0);

  return {
    decide(state: GameState, pid: number): Action {
      const p = state.players[pid]!;

      // 1. 升级：差多少经验付多少金币，付得起就升
      const cost = expToUpgrade(p.shopLevel);
      if (cost !== null && p.gold >= Math.max(0, cost - p.exp)) {
        return { type: "upgradeShop", player: pid };
      }

      // 2. 买牌：优先凑三合一（已有 2 张同卡），其次买得起的
      const slots = [0, 1, 2].filter((i) => p.shop[i] !== null);
      const trioSlot = slots.find((i) => {
        const id = p.shop[i]!;
        return copyCount(p, id) === 2 && canAfford(p, id);
      });
      if (trioSlot !== undefined) {
        return { type: "buy", player: pid, shopIndex: trioSlot as 0 | 1 | 2 };
      }
      const anySlot = slots.find((i) => canAfford(p, p.shop[i]!));
      if (anySlot !== undefined) {
        return { type: "buy", player: pid, shopIndex: anySlot as 0 | 1 | 2 };
      }

      // 3. 10% 概率刷新（商店已空且付得起）——消耗的是 AI 自己的 RNG
      if (slots.length === 0 && rng() < 0.1 && (p.freeRefresh > 0 || p.gold >= shopConfig.refreshCost)) {
        return { type: "refresh", player: pid };
      }

      // 4. 上阵：手牌中未上场的放到第一个空位
      const idle = p.hand.find((c) => c.position === null);
      if (idle) {
        const emptyIdx = p.board.findIndex((c) => c === null);
        if (emptyIdx >= 0) {
          return { type: "move", player: pid, cardUid: idle.uid, position: emptyIdx + 1 };
        }
      }

      // 5. 结束商店阶段
      return { type: "endShop", player: pid };
    },
  };
}

/** 驱动 AI 完成整个商店阶段（逐条 applyAction，保证合法性与确定性） */
export function runBotTurn(
  state: GameState,
  gameRng: Rng,
  playerId: number,
  bot: Bot,
): void {
  let guard = 0;
  while (!state.players[playerId]!.shopDone && guard++ < 500) {
    applyAction(state, gameRng, bot.decide(state, playerId));
  }
  if (!state.players[playerId]!.shopDone) {
    throw new Error(`runBotTurn: 玩家 ${playerId} 的 AI 未在保护次数内结束商店阶段`);
  }
}
