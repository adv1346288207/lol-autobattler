import { describe, expect, it } from "vitest";
import { createCardInstance, createGame } from "../core/state";
import { goldForRound, expToUpgrade } from "../config/economy";
import { damageFromSurvivingHp } from "../config/damage";
import { validateConfig } from "../config/validate";
import { shopConfig } from "../config/shop";
import { CARD_POOL } from "../config/cards";

describe("配置校验", () => {
  it("配置表无错误", () => {
    expect(validateConfig()).toEqual([]);
  });

  it("橙卡概率符合用户确认：L1~L3=0、L4=10、L5=30", () => {
    expect(shopConfig.qualityOdds[0]!.orange).toBe(0);
    expect(shopConfig.qualityOdds[1]!.orange).toBe(0);
    expect(shopConfig.qualityOdds[2]!.orange).toBe(0);
    expect(shopConfig.qualityOdds[3]!.orange).toBe(10);
    expect(shopConfig.qualityOdds[4]!.orange).toBe(30);
  });

  it("分裂者是金卡品质的万能牌", () => {
    const f = CARD_POOL.find((c) => c.id === "fenliezhe");
    expect(f?.quality).toBe("gold");
    expect(f?.wildcard).toBe("role");
  });
});

describe("GameState 工厂", () => {
  it("8 名玩家、玩家 0 为人类、初始血量 30、阶段 shop、回合 1", () => {
    const state = createGame(123);
    expect(state.players).toHaveLength(8);
    expect(state.players[0]!.isHuman).toBe(true);
    expect(state.players.slice(1).every((p) => !p.isHuman)).toBe(true);
    for (const p of state.players) {
      expect(p.hp).toBe(30);
      expect(p.gold).toBe(0);
      expect(p.exp).toBe(0);
      expect(p.shopLevel).toBe(1);
      expect(p.hand).toEqual([]);
      expect(p.board).toHaveLength(6);
      expect(p.board.every((c) => c === null)).toBe(true);
      expect(p.shop).toHaveLength(3);
      expect(p.eliminated).toBe(false);
    }
    expect(state.phase).toBe("shop");
    expect(state.round).toBe(1);
  });

  it("createCardInstance 分配递增 UID 并从配置读属性", () => {
    const state = createGame(1);
    const a = createCardInstance(state, "lan");
    const b = createCardInstance(state, "lan");
    expect(a.uid).toBe(1);
    expect(b.uid).toBe(2);
    expect(a.level).toBe(1);
    expect(a.atk).toBe(2);
    expect(a.hp).toBe(2);
    expect(a.position).toBeNull();
  });
});

describe("金币阶梯（用户确认：R1=2、前10回合+1、之后+2、封顶20）", () => {
  it("关键回合锚点", () => {
    expect(goldForRound(1)).toBe(2);
    expect(goldForRound(2)).toBe(3);
    expect(goldForRound(10)).toBe(11);
    expect(goldForRound(11)).toBe(13);
    expect(goldForRound(15)).toBe(20);
    expect(goldForRound(20)).toBe(20);
    expect(goldForRound(99)).toBe(20);
  });
});

describe("经验升级", () => {
  it("升级需求表：1→2 需 2、2→3 需 8（用户举例）、5 级满", () => {
    expect(expToUpgrade(1)).toBe(2);
    expect(expToUpgrade(2)).toBe(8);
    expect(expToUpgrade(3)).toBe(12); // 占位，待用户确认
    expect(expToUpgrade(4)).toBe(16); // 占位，待用户确认
    expect(expToUpgrade(5)).toBeNull();
  });
});

describe("伤害公式（饱和曲线，锚点按方案表）", () => {
  it("锚点：10→7、30→16、50→21、80→26、120→29、200→30", () => {
    expect(damageFromSurvivingHp(10)).toBe(7);
    expect(damageFromSurvivingHp(30)).toBe(16);
    expect(damageFromSurvivingHp(50)).toBe(21);
    expect(damageFromSurvivingHp(80)).toBe(26);
    expect(damageFromSurvivingHp(120)).toBe(29);
    expect(damageFromSurvivingHp(200)).toBe(30);
    expect(damageFromSurvivingHp(100000)).toBe(30); // 封顶
    expect(damageFromSurvivingHp(0)).toBe(0);
  });
});
