import { describe, expect, it } from "vitest";
import { createGame, totalAtk, totalHp, type GameState } from "../core/state";
import { CARD_BY_ID, HERO_CARDS, WEAPON_CARDS } from "../config/cards";
import { shopConfig } from "../config/shop";
import { economyConfig, goldForRound } from "../config/economy";
import { applyGrowth, beginRound } from "../core/phase";
import { createRng } from "../core/rng";
import { makeCtx, place, giveHand } from "./helpers";

/** 开局赠礼：每人 1 个绿色英雄（直接上阵）+ 1 件绿色武器（进武器库） */
describe("开局赠礼", () => {
  const greenHeroes = new Set(HERO_CARDS.filter((c) => c.quality === "green").map((c) => c.id));
  const greenWeapons = new Set(WEAPON_CARDS.filter((c) => c.quality === "green").map((c) => c.id));

  it("8 名玩家每人都拿到 1 个绿英雄（在 1 号位）+ 1 件绿武器", () => {
    const state = createGame(7);
    for (const p of state.players) {
      const onBoard = p.board.filter((c) => c !== null);
      expect(onBoard).toHaveLength(1);
      expect(greenHeroes.has(onBoard[0]!.configId)).toBe(true);
      expect(onBoard[0]!.position).toBe(1);
      expect(p.board[0]).toBe(onBoard[0]);
      expect(p.weapons).toHaveLength(1);
      expect(greenWeapons.has(p.weapons[0]!.configId)).toBe(true);
    }
  });

  it("赠礼不占手牌，且不同玩家可以拿到不同英雄（由 seed 派生）", () => {
    const state = createGame(3);
    for (const p of state.players) expect(p.hand).toHaveLength(0);
    const picks = new Set(state.players.map((p) => p.board[0]!.configId));
    expect(picks.size).toBeGreaterThan(1);
  });

  it("同 seed 完全一致（可回放）", () => {
    const a = createGame(99);
    const b = createGame(99);
    const snap = (s: GameState) =>
      s.players.map((p) => `${p.board[0]?.configId}/${p.weapons[0]?.configId}`).join(",");
    expect(snap(a)).toBe(snap(b));
  });

  it("startingLoadout:false 时不发赠礼（测试要干净棋盘时用）", () => {
    const state = createGame(7, null, { startingLoadout: false });
    for (const p of state.players) {
      expect(p.board.every((c) => c === null)).toBe(true);
      expect(p.weapons).toHaveLength(0);
    }
  });

  it("第 1 回合收入后正好 2 金币（用户要求的初始金币）", () => {
    expect(economyConfig.goldStart).toBe(2);
    expect(goldForRound(1)).toBe(2);
    const state = createGame(7);
    beginRound(state, createRng(7));
    for (const p of state.players) expect(p.gold).toBe(2);
  });

  it("赠礼品质受 shopConfig 控制，避免有人改成别的品质后测试失效", () => {
    expect(shopConfig.startingHeroQuality).toBe("green");
    expect(shopConfig.startingWeaponQuality).toBe("green");
  });
});

/** 成长属性：上阵期间每回合永久 +atk/+hp */
describe("成长属性", () => {
  const GROWER = "darius"; // growth: { atk: 1 }
  const TANK = "swain"; // growth: { hp: 3 }
  const PLAIN = "garen"; // 无成长

  it("配置上确实有 4 名成长英雄，且他们当前的羁绊是偏弱的那两个", () => {
    const growers = HERO_CARDS.filter((c) => c.growth);
    expect(growers.map((c) => c.id).sort()).toEqual(["darius", "draven", "jinx", "swain"]);
    for (const g of growers) expect((g.growth!.atk ?? 0) + (g.growth!.hp ?? 0)).toBeGreaterThan(0);
  });

  it("上阵的成长英雄每回合涨属性，总攻血同步变高", () => {
    const { state, p } = makeCtx(11);
    const card = place(state, p, GROWER, 1);
    const baseAtk = totalAtk(card);
    const baseHp = totalHp(card);

    applyGrowth(p, 2);
    expect(totalAtk(card)).toBe(baseAtk + 1);
    expect(totalHp(card)).toBe(baseHp);
    expect(card.atk).toBe(CARD_BY_ID.get(GROWER)!.atk); // 基础值不被污染

    applyGrowth(p, 3);
    expect(card.growthAtk).toBe(2);
  });

  it("只涨生命型的英雄只涨血（斯维因 +3/回合）", () => {
    const { state, p } = makeCtx(12);
    const card = place(state, p, TANK, 1);
    const baseAtk = totalAtk(card);
    applyGrowth(p, 2);
    expect(totalAtk(card)).toBe(baseAtk);
    expect(card.growthHp).toBe(3);
  });

  it("没配成长的英雄不会涨", () => {
    const { state, p } = makeCtx(13);
    const card = place(state, p, PLAIN, 1);
    applyGrowth(p, 5);
    expect(card.growthAtk).toBe(0);
    expect(card.growthHp).toBe(0);
  });

  it("**在手牌里不成长**（必须上阵）", () => {
    const { state, p } = makeCtx(14);
    const benched = giveHand(state, p, GROWER);
    applyGrowth(p, 4);
    expect(benched.growthAtk).toBe(0);
  });

  it("成长跟着卡走：拿下场不清零，只是不再涨", () => {
    const { state, p } = makeCtx(15);
    const card = place(state, p, GROWER, 1);
    applyGrowth(p, 2);
    expect(card.growthAtk).toBe(1);
    // 移到手牌（下场）
    p.board[0] = null;
    card.position = null;
    p.hand.push(card);
    applyGrowth(p, 3);
    expect(card.growthAtk).toBe(1); // 没涨、也没掉
  });

  it("growth.every 控制频率（每 2 回合涨一次）", () => {
    const { state, p } = makeCtx(16);
    const card = place(state, p, GROWER, 1);
    const cfg = CARD_BY_ID.get(GROWER)!;
    const orig = cfg.growth;
    cfg.growth = { atk: 2, every: 2 };
    try {
      applyGrowth(p, 1); // 奇数回合不涨
      expect(card.growthAtk).toBe(0);
      applyGrowth(p, 2);
      expect(card.growthAtk).toBe(2);
      applyGrowth(p, 3);
      expect(card.growthAtk).toBe(2);
      applyGrowth(p, 4);
      expect(card.growthAtk).toBe(4);
    } finally {
      cfg.growth = orig;
    }
  });

  it("beginRound 会自动结算成长（不需要手动调）", () => {
    const { state, p } = makeCtx(17);
    const card = place(state, p, GROWER, 1);
    state.round = 5;
    beginRound(state, createRng(17));
    expect(card.growthAtk).toBe(1);
  });
});
