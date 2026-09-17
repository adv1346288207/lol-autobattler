import { describe, expect, it } from "vitest";
import { makeCtx, place, giveHand } from "./helpers";
import { createGame } from "../core/state";
import { createRng } from "../core/rng";
import { beginRound, resolveRound } from "../core/phase";
import { applyAction } from "../core/actions";
import {
  activeTraitIds,
  choosePosition,
  createBot,
  enemyBacklineColumn,
  positionOrder,
  runBotTurn,
  slotScore,
  traitSnapshotOf,
  worstHandCard,
  baseScore,
  cardScoreOf,
} from "../bot/random";
import { CARD_BY_ID } from "../config/cards";
import { shopConfig } from "../config/shop";

/**
 * AI（T1）：购买评分、三合一优先、羁绊升级、前后排站位、刺客切列、确定性
 */

describe("购买评分（纯函数）", () => {
  it("高价值卡评分高于低价值卡", () => {
    const { state, p } = makeCtx(1);
    void state;
    const jarvan = slotScore(p, "jarvan_iv", 1);
    const garen = slotScore(p, "garen", 1);
    const duplicator = slotScore(p, "duplicator", 1);
    expect(jarvan).toBeGreaterThan(garen);
    expect(garen).toBeGreaterThan(duplicator);
  });

  it("同名第 2 张带来合成分；第 3 张（补成三合一）分显著提高", () => {
    const { state, p } = makeCtx(1);
    const before = slotScore(p, "garen", 1);
    giveHand(state, p, "garen");
    const one = slotScore(p, "garen", 1);
    giveHand(state, p, "garen");
    const two = slotScore(p, "garen", 1);
    // 第 2 张：+5 合成分，但同名不再增加羁绊人数（"新羁绊"分消失）
    expect(one).toBeLessThan(before);
    // 第 3 张：直接补成三合一
    expect(two).toBeGreaterThan(one + 20);
    expect(two).toBeGreaterThan(before + 15);
  });

  it("能激活新羁绊的卡获得额外分", () => {
    const { state, p } = makeCtx(1);
    place(state, p, "garen", 1); // 德玛西亚 1 人
    const snap = traitSnapshotOf(p);
    const poppy = slotScore(p, "poppy", 1, snap); // 补到德玛西亚 2 人 + 先锋 2 人
    const kalista = slotScore(p, "kalista", 1, snap); // 无法激活任何羁绊
    expect(poppy).toBeGreaterThan(kalista);
  });

  it("补到 4 人档的羁绊分高于普通补位", () => {
    const { state, p } = makeCtx(1);
    place(state, p, "garen", 1);
    place(state, p, "poppy", 2);
    place(state, p, "lux", 3); // 德玛西亚 3 人
    const snap = traitSnapshotOf(p);
    const jarvan = slotScore(p, "jarvan_iv", 1, snap); // → 德玛西亚 4 人档
    const viego = slotScore(p, "viego", 1, snap);
    expect(jarvan).toBeGreaterThan(viego);
  });
});

describe("AI 决策（真实状态）", () => {
  function botState(seed = 99) {
    const state = createGame(seed);
    const rng = createRng(seed);
    const bot = createBot(seed, 0);
    const p = state.players[0]!;
    beginRound(state, rng);
    return { state, rng, bot, p };
  }

  it("会比较多张卡，而不是只买第一个买得起的", () => {
    const { state, rng, bot, p } = botState();
    p.gold = 20;
    p.shop = ["duplicator", "garen", "jarvan_iv"];
    const action = bot.decide(state, 0);
    expect(action).toEqual({ type: "buy", player: 0, shopIndex: 2 });
    void rng;
  });

  it("优先完成三合一（即使另一张卡评分更高）", () => {
    const { state, bot, p } = botState();
    p.gold = 20;
    giveHand(state, p, "garen");
    giveHand(state, p, "garen");
    p.shop = ["jarvan_iv", "garen", "lux"];
    const action = bot.decide(state, 0);
    expect(action).toEqual({ type: "buy", player: 0, shopIndex: 1 });
  });

  it("手牌拥堵时会卖掉最没用的散牌", () => {
    const { state, bot, p } = botState();
    p.gold = 0;
    for (let i = 0; i < shopConfig.handLimit - 1; i++) giveHand(state, p, "duplicator");
    const junk = giveHand(state, p, "garen");
    p.shop = [null, null, null];
    const action = bot.decide(state, 0);
    expect(action.type).toBe("sell");
    void junk;
  });

  it("会把单位放上棋盘（前排/后排规则）", () => {
    const { state, bot, p } = botState();
    p.shop = [null, null, null];
    giveHand(state, p, "garen"); // 前排
    giveHand(state, p, "jinx"); // 后排
    const a1 = bot.decide(state, 0);
    expect(a1.type).toBe("move");
    applyAction(state, createRng(1), a1);
    const a2 = bot.decide(state, 0);
    expect(a2.type).toBe("move");
    applyAction(state, createRng(1), a2);
    expect(p.board[0]!.configId).toBe("garen"); // 1 号位给前排
    expect(p.board[3]!.configId).toBe("jinx"); // 4 号位给后排
  });

  it("决策确定性：同 seed 的 AI 同状态给出相同动作", () => {
    const run = () => {
      const state = createGame(4242);
      const rng = createRng(4242);
      const bot = createBot(4242, 0);
      beginRound(state, rng);
      state.players[0]!.gold = 20;
      const actions = [];
      for (let i = 0; i < 12; i++) {
        const a = bot.decide(state, 0);
        actions.push(a);
        try {
          applyAction(state, rng, a);
        } catch {
          break;
        }
      }
      return JSON.stringify(actions);
    };
    expect(run()).toBe(run());
  });

  it("始终能在保护次数内结束商店阶段", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const state = createGame(seed);
      const rng = createRng(seed);
      beginRound(state, rng);
      const bot = createBot(seed, 0);
      runBotTurn(state, rng, 0, bot);
      expect(state.players[0]!.shopDone).toBe(true);
    }
  });
});

describe("站位（纯函数）", () => {
  it("先锋/战士排位从前排开始", () => {
    const { state } = makeCtx(1);
    expect(positionOrder(state, 0, CARD_BY_ID.get("garen")!)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(positionOrder(state, 0, CARD_BY_ID.get("vi")!)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("射手/法师/辅助排位从后排开始", () => {
    const { state } = makeCtx(1);
    expect(positionOrder(state, 0, CARD_BY_ID.get("jinx")!)).toEqual([4, 5, 6, 1, 2, 3]);
    expect(positionOrder(state, 0, CARD_BY_ID.get("ahri")!)).toEqual([4, 5, 6, 1, 2, 3]);
    expect(positionOrder(state, 0, CARD_BY_ID.get("thresh")!)).toEqual([4, 5, 6, 1, 2, 3]);
  });

  it("刺客按对手后排压力最大的列选位", () => {
    const { state } = makeCtx(1);
    const enemy = state.players[1]!;
    const strong = place(state, enemy, "lux", 4); // 0 列后排
    strong.atk = 12;
    place(state, enemy, "jinx", 5); // 1 列后排
    expect(enemyBacklineColumn(state, 0)).toBe(0);
    const order = positionOrder(state, 0, CARD_BY_ID.get("katarina")!);
    expect(order.slice(0, 2)).toEqual([1, 4]);

    // 1 列变强 → 刺客改选 1 列
    const other = place(state, enemy, "caitlyn", 5);
    other.atk = 99;
    expect(enemyBacklineColumn(state, 0)).toBe(1);
    expect(positionOrder(state, 0, CARD_BY_ID.get("katarina")!).slice(0, 2)).toEqual([2, 5]);
  });

  it("棋盘已满时 choosePosition 返回 null", () => {
    const { state, p } = makeCtx(1);
    for (let i = 1; i <= 6; i++) place(state, p, "garen", i);
    const extra = giveHand(state, p, "jinx");
    expect(choosePosition(state, p, extra)).toBeNull();
  });
});

describe("整局表现", () => {
  it("AI 会在前几回合把单位放上场，并激活羁绊", () => {
    const state = createGame(20260817);
    const rng = createRng(20260817);
    const bots = new Map(state.players.map((p) => [p.id, createBot(20260817, p.id)]));
    beginRound(state, rng);
    for (let round = 0; round < 8 && state.phase !== "ended"; round++) {
      for (const p of [...state.players]) {
        if (!p.eliminated && !p.shopDone) runBotTurn(state, rng, p.id, bots.get(p.id)!);
      }
      resolveRound(state, rng);
    }
    const alive = state.players.filter((p) => !p.eliminated);
    const boards = alive.map((p) => p.board.filter((c) => c !== null).length);
    expect(Math.min(...boards)).toBeGreaterThanOrEqual(3); // 每个 AI 都填了棋盘
    const anyTrait = alive.some((p) => activeTraitIds(p).length > 0);
    expect(anyTrait).toBe(true);
  });

  it("AI 会主动出售/替换：手牌不会长期堆满", () => {
    const state = createGame(555);
    const rng = createRng(555);
    const bots = new Map(state.players.map((p) => [p.id, createBot(555, p.id)]));
    beginRound(state, rng);
    for (let round = 0; round < 6 && state.phase !== "ended"; round++) {
      for (const p of [...state.players]) {
        if (!p.eliminated && !p.shopDone) runBotTurn(state, rng, p.id, bots.get(p.id)!);
      }
      resolveRound(state, rng);
    }
    for (const p of state.players) {
      expect(p.hand.length).toBeLessThanOrEqual(shopConfig.handLimit);
      expect(p.gold).toBeGreaterThanOrEqual(0);
    }
  });

  it("baseScore / cardScoreOf 是稳定纯函数", () => {
    const { state, p } = makeCtx(1);
    const garen = place(state, p, "garen", 1);
    const before = cardScoreOf(p, garen);
    expect(cardScoreOf(p, garen)).toBe(before);
    const gold = giveHand(state, p, "garen");
    gold.level = 2;
    expect(cardScoreOf(p, gold)).toBeGreaterThan(before);
    expect(baseScore(CARD_BY_ID.get("jarvan_iv")!)).toBeGreaterThan(baseScore(CARD_BY_ID.get("garen")!));
  });

  it("worstHandCard 不拆对子", () => {
    const { state, p } = makeCtx(1);
    giveHand(state, p, "garen");
    giveHand(state, p, "garen");
    giveHand(state, p, "jinx");
    const junk = worstHandCard(p);
    expect(junk?.configId).toBe("jinx");
  });
});
