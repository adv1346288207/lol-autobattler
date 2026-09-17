/**
 * 对局地图（开局匹配阶段由 8 名玩家投票决定）
 * 每张地图给**双方全体英雄**一个固定的开战加成，效果在 core/battle.ts 开战时结算。
 * 数值刻意做得温和，避免地图直接决定胜负。
 */
export type MapId = "summoners_rift" | "howling_abyss" | "zaun_undercity";

export interface MapEffect {
  /** 最大生命加成 */
  maxHp?: number;
  /** 攻击力加成 */
  atk?: number;
  /** 开战初始法力加成 */
  startMana?: number;
  /** 开战护盾 */
  shield?: number;
}

export interface GameMap {
  id: MapId;
  name: string;
  /** 一句话效果说明（投票界面与顶栏提示用） */
  desc: string;
  /** 氛围描述 */
  flavor: string;
  /** 卡面渐变配色（原创，不使用官方素材） */
  colors: [string, string];
  icon: string;
  effect: MapEffect;
}

export const GAME_MAPS: GameMap[] = [
  {
    id: "summoners_rift",
    name: "召唤师峡谷",
    desc: "全体英雄 +2 最大生命",
    flavor: "开阔的三路战场，容错更高",
    colors: ["#1f5f8b", "#123049"],
    icon: "🌿",
    effect: { maxHp: 2 },
  },
  {
    id: "howling_abyss",
    name: "嚎哭深渊",
    desc: "全体英雄开局 +10 法力",
    flavor: "狭长冰原，技能来得更快",
    colors: ["#2b3f8f", "#141c40"],
    icon: "❄",
    effect: { startMana: 10 },
  },
  {
    id: "zaun_undercity",
    name: "祖安地下城",
    desc: "全体英雄 +1 攻击力",
    flavor: "炼金废土，输出更凶",
    colors: ["#4a2f7a", "#1d1235"],
    icon: "⚗",
    effect: { atk: 1 },
  },
];

export const MAP_IDS: MapId[] = GAME_MAPS.map((m) => m.id);

export const MAP_BY_ID: ReadonlyMap<MapId, GameMap> = new Map(GAME_MAPS.map((m) => [m.id, m]));

export function mapName(id: MapId | null): string {
  return id ? (MAP_BY_ID.get(id)?.name ?? id) : "未选择";
}

/** 由 seed 确定性地挑一张地图（CLI 批量模拟、AI 投票基准用） */
export function pickMapForSeed(seed: number): MapId {
  const i = Math.abs(Math.floor(seed)) % MAP_IDS.length;
  return MAP_IDS[i]!;
}

export interface MapVoteResult {
  /** 每个玩家投的地图（下标 = 玩家 id） */
  votes: MapId[];
  /** 每张地图得票 */
  tally: Record<string, number>;
  /** 最终生效地图 */
  winner: MapId;
}

/**
 * 由 seed + 玩家 id 派生一票。
 * ⚠️ 必须真正打散：之前用的是 `seed * 2654435761 + pid * 40503`，而 40503 = 3 × 13501 能被 3 整除，
 * 取模 3 之后 8 个人的票**永远一样**（"人机总是选同一张地图"就是这么来的）。
 * 这里改用 murmur 风格的整数混合，全程 Math.imul 不丢精度。
 */
export function deriveMapVote(seed: number, pid: number): MapId {
  let h = (seed ^ Math.imul(pid + 1, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return MAP_IDS[h % MAP_IDS.length]!;
}

/**
 * 开局地图投票：玩家 0 用玩家选择，其余 7 名 AI 由 seed 派生随机投票；
 * 得票最多者胜出，平票时按 seed 派生的默认地图破同分（确定性）。
 */
export function tallyMapVotes(seed: number, playerVote: MapId | null, playerCount = 8): MapVoteResult {
  const votes: MapId[] = [];
  const tally: Record<string, number> = {};
  for (const id of MAP_IDS) tally[id] = 0;

  for (let pid = 0; pid < playerCount; pid++) {
    const vote = pid === 0 && playerVote ? playerVote : deriveMapVote(seed, pid);
    votes.push(vote);
    tally[vote] = (tally[vote] ?? 0) + 1;
  }

  let best = -1;
  for (const id of MAP_IDS) best = Math.max(best, tally[id] ?? 0);
  const top = MAP_IDS.filter((id) => (tally[id] ?? 0) === best);
  const fallback = MAP_IDS[Math.abs(seed) % MAP_IDS.length]!;
  const winner = top.includes(fallback) ? fallback : top[0]!;
  return { votes, tally, winner };
}
