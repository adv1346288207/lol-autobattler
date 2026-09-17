import { describe, expect, it } from "vitest";
import { makeCtx, place, battleCtx, eventsOfType } from "./helpers";
import { runBattle } from "../core/battle";
import { createGame } from "../core/state";
import {
  GAME_MAPS,
  MAP_BY_ID,
  MAP_IDS,
  mapName,
  pickMapForSeed,
  tallyMapVotes,
  deriveMapVote,
  type MapId,
} from "../config/maps";
import { CARD_BY_ID } from "../config/cards";
import { runAutoGame } from "../bot/simulation";

/**
 * 地图（T-M）：开局匹配阶段 8 人投票决定，开战时给双方全体英雄固定加成。
 */
describe("地图配置", () => {
  it("恰好 3 张地图，ID 唯一，且每张都有名字/说明/效果", () => {
    expect(GAME_MAPS).toHaveLength(3);
    expect(new Set(MAP_IDS).size).toBe(3);
    for (const map of GAME_MAPS) {
      expect(map.name.length).toBeGreaterThan(0);
      expect(map.desc.length).toBeGreaterThan(0);
      expect(Object.keys(map.effect).length).toBeGreaterThan(0);
      expect(MAP_BY_ID.get(map.id)).toBe(map);
    }
  });

  it("pickMapForSeed 确定性且覆盖三张地图", () => {
    expect(pickMapForSeed(7)).toBe(pickMapForSeed(7));
    const seen = new Set<MapId>();
    for (let seed = 0; seed < 30; seed++) seen.add(pickMapForSeed(seed));
    expect(seen.size).toBe(3);
  });

  it("mapName 处理空值", () => {
    expect(mapName(null)).toBe("未选择");
    expect(mapName("howling_abyss")).toBe("嚎哭深渊");
  });
});

describe("开局地图投票", () => {
  it("8 名玩家各投一票，胜出者是票数最多的一方", () => {
    for (const seed of [1, 2, 3, 42, 777]) {
      const result = tallyMapVotes(seed, null);
      expect(result.votes).toHaveLength(8);
      const counts = MAP_IDS.map((id) => result.tally[id] ?? 0);
      expect(counts.reduce((a, b) => a + b, 0)).toBe(8);
      expect(result.tally[result.winner]).toBe(Math.max(...counts));
    }
  });

  it("同 seed 完全一致（可回放）", () => {
    for (const seed of [5, 6, 7]) {
      expect(tallyMapVotes(seed, "zaun_undercity")).toEqual(tallyMapVotes(seed, "zaun_undercity"));
    }
  });

  it("玩家投票会记到自己名下并计入票数", () => {
    const noVote = tallyMapVotes(11, null);
    const voted = tallyMapVotes(11, "summoners_rift");
    expect(voted.votes[0]).toBe("summoners_rift");
    expect(voted.tally.summoners_rift).toBe((noVote.tally.summoners_rift ?? 0) + (noVote.votes[0] === "summoners_rift" ? 0 : 1));
  });

  it("AI 投票必须真的分散：不能 8 个人全投同一张（回归 bug：pid*40503 能被 3 整除）", () => {
    let unanimous = 0;
    const seenOverall = new Set<MapId>();
    for (let seed = 0; seed < 60; seed++) {
      const r = tallyMapVotes(seed, null);
      const distinct = new Set<MapId>(r.votes);
      for (const v of distinct) seenOverall.add(v);
      if (distinct.size === 1) unanimous++;
    }
    // 3 张图随机投 8 票，全票一致的概率约 1/6561，60 个种子几乎不可能出现
    expect(unanimous).toBe(0);
    expect(seenOverall.size).toBe(3);
  });

  it("deriveMapVote 对同一 seed 的不同玩家给出不同票（哨兵：相邻 pid 不能同票）", () => {
    for (const seed of [1, 7, 42, 99, 2024]) {
      const votes = [0, 1, 2, 3, 4, 5, 6, 7].map((pid) => deriveMapVote(seed, pid));
      expect(new Set(votes).size).toBeGreaterThan(1);
      // 确定性
      expect(deriveMapVote(seed, 3)).toBe(deriveMapVote(seed, 3));
    }
  });

  it("平票时用 seed 派生的默认地图破同分（结果稳定）", () => {
    // 构造大量 seed，确认平票情况下也不会出现 undefined
    for (let seed = 0; seed < 200; seed++) {
      const r = tallyMapVotes(seed, null);
      expect(MAP_IDS).toContain(r.winner);
    }
  });
});

describe("地图加成在战斗中生效", () => {
  it("祖安地下城：全体英雄 +1 攻击力，并产出 MAP_EFFECT 事件", () => {
    const { state, p } = makeCtx(101);
    const enemy = state.players[1]!;
    state.mapId = "zaun_undercity";
    const me = place(state, p, "garen", 1);
    place(state, enemy, "draven", 1);
    const ctx = battleCtx(state);
    const events = runBattle(ctx);
    const start = eventsOfType(events, "BATTLE_START")[0]!;
    const snap = start.boards.a.find((u) => u.uid === me.uid)!;
    expect(snap.atk).toBe(CARD_BY_ID.get("garen")!.atk + 1);
    expect(eventsOfType(events, "MAP_EFFECT")).toHaveLength(2); // 双方各一次
    expect(eventsOfType(events, "MAP_EFFECT")[0]!.mapId).toBe("zaun_undercity");
  });

  it("嚎哭深渊：全体英雄开局 +10 法力", () => {
    const { state, p } = makeCtx(102);
    const enemy = state.players[1]!;
    state.mapId = "howling_abyss";
    const me = place(state, p, "ahri", 1); // 30/80
    place(state, enemy, "garen", 1);
    const ctx = battleCtx(state);
    const events = runBattle(ctx);
    const start = eventsOfType(events, "BATTLE_START")[0]!;
    const snap = start.boards.a.find((u) => u.uid === me.uid)!;
    expect(snap.mana).toBe(CARD_BY_ID.get("ahri")!.startMana + 10);
  });

  it("召唤师峡谷：全体英雄 +2 最大生命且当前生命同步补足", () => {
    const { state, p } = makeCtx(103);
    const enemy = state.players[1]!;
    state.mapId = "summoners_rift";
    const me = place(state, p, "garen", 1);
    place(state, enemy, "garen", 1);
    const ctx = battleCtx(state);
    const events = runBattle(ctx);
    const start = eventsOfType(events, "BATTLE_START")[0]!;
    const snap = start.boards.a.find((u) => u.uid === me.uid)!;
    const base = CARD_BY_ID.get("garen")!.hp;
    expect(snap.maxHp).toBe(base + 2);
    expect(snap.hp).toBe(base + 2);
  });

  it("没有地图时不产出 MAP_EFFECT 事件", () => {
    const { state, p } = makeCtx(104);
    const enemy = state.players[1]!;
    place(state, p, "garen", 1);
    place(state, enemy, "garen", 1);
    const ctx = battleCtx(state);
    const events = runBattle(ctx);
    expect(eventsOfType(events, "MAP_EFFECT")).toHaveLength(0);
  });
});

describe("地图与整局模拟", () => {
  it("批量对局里三张地图都会出现，且不再依赖外部状态", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 9; seed++) {
      const state = runAutoGame(seed);
      expect(state.mapId).not.toBeNull();
      seen.add(state.mapId!);
    }
    expect(seen.size).toBe(3);
  });

  it("createGame 默认不带地图（旧测试/回放不受影响）", () => {
    expect(createGame(1).mapId).toBeNull();
    expect(createGame(1, "howling_abyss").mapId).toBe("howling_abyss");
  });
});
