/**
 * 评分制 AI（M2/M4 → LoL 改造版）
 * 接口与人类玩家完全一致（逐条返回 Action）——将来替换为网络玩家零改动
 *
 * 评分（§17）：
 *   总分 = 基础卡强度 + 同名合成分 + 激活/升级羁绊分 + 阵容缺口分 + 商店阶段修正 - 手牌拥堵惩罚
 * 站位：先锋/战士优先前排 1~3；射手/法师/辅助优先后排 4~6；刺客按对手后排选择列。
 * 所有评分函数都是纯函数，便于单测；同分按 uid/槽位号破同分，保证确定性。
 *
 * ⚠️ AI 使用独立随机源（由 seed+playerId 派生），不消耗对局 RNG：
 *    保证回放时 Action 日志可原样重放、AI 决策不扰动对局随机流（联机同理）
 */
import type { Action } from "../core/actions";
import { applyAction } from "../core/actions";
import type { CardInstance, GameState, PlayerState } from "../core/state";
import { totalAtk, totalHp, hasFreeEquipSlot } from "../core/state";
import { weaponScore } from "../core/actions";
import { createRng, type Rng } from "../core/rng";
import type { CardConfig } from "../config/cards";
import { CARD_BY_ID } from "../config/cards";
import { shopConfig } from "../config/shop";
import { goldToUpgrade } from "../config/economy";
import { TRAIT_BY_ID, type Profession, type TraitId } from "../config/traits";

export interface Bot {
  decide(state: GameState, playerId: number): Action;
  /** 调试统计（只用于测试/CLI，绝不进入核心状态） */
  stats: BotStats;
}

export interface BotStats {
  buys: number;
  sells: number;
  refreshes: number;
  upgrades: number;
  moves: number;
  equips: number;
}

const FRONTLINE: Profession[] = ["vanguard", "warrior"];
const BACKLINE: Profession[] = ["marksman", "mage", "support"];

/** 卡牌品质权重（强度之外的稀有度价值） */
const QUALITY_WEIGHT: Record<string, number> = {
  green: 0,
  blue: 1.5,
  purple: 3.5,
  orange: 6,
  gold: 3,
};

export function configOf(configId: string): CardConfig | undefined {
  return CARD_BY_ID.get(configId);
}

/* ══════════════ 基础评分（纯函数） ══════════════ */

/** 基础卡强度：攻防 + 技能 + 品质 */
export function baseScore(card: CardConfig): number {
  const skillBonus = card.skill ? 5 + card.skill.steps.length * 2 : 0;
  const manaBonus = card.maxMana > 0 ? 1.5 : 0;
  return card.atk * 1.2 + card.hp * 0.7 + skillBonus + manaBonus + (QUALITY_WEIGHT[card.quality] ?? 0);
}

/** 场上（含手牌）的不同 configId 与羁绊人数 */
export interface TraitSnapshot {
  counts: Map<TraitId, number>;
  seen: Set<string>;
}

export function traitSnapshotOf(p: PlayerState): TraitSnapshot {
  const seen = new Set<string>();
  const counts = new Map<TraitId, number>();
  const cards: CardInstance[] = [...p.board.filter((c): c is CardInstance => c !== null), ...p.hand];
  for (const c of cards) {
    if (seen.has(c.configId)) continue;
    seen.add(c.configId);
    const cfg = CARD_BY_ID.get(c.configId);
    if (!cfg) continue;
    if (cfg.region) counts.set(cfg.region, (counts.get(cfg.region) ?? 0) + 1);
    for (const prof of cfg.professions) counts.set(prof, (counts.get(prof) ?? 0) + 1);
  }
  return { counts, seen };
}

/** 羁绊分：激活 2 人档 / 升级到 4 人档 / 开拓新线 */
export function traitScore(snap: TraitSnapshot, card: CardConfig): number {
  if (snap.seen.has(card.id)) return 0; // 同名英雄不增加羁绊人数
  const ids: TraitId[] = [];
  if (card.region) ids.push(card.region);
  ids.push(...card.professions);
  let score = 0;
  for (const id of ids) {
    const cur = snap.counts.get(id) ?? 0;
    const cfg = TRAIT_BY_ID.get(id);
    if (!cfg) continue;
    if (cur === 0) score += 3;
    else if (cur === cfg.thresholds[0] - 1) score += 13; // 直接激活 2 人档
    else if (cur === cfg.thresholds[1] - 1) score += 18; // 升级到 4 人档
    else score += 2;
  }
  return score;
}

/** 阵容缺口：缺前排 / 缺输出的补位价值 */
export function compositionScore(p: PlayerState, card: CardConfig): number {
  const onBoard = p.board.filter((c): c is CardInstance => c !== null);
  const count = (profList: Profession[]) =>
    onBoard.filter((c) => {
      const cfg = CARD_BY_ID.get(c.configId);
      return cfg ? cfg.professions.some((x) => profList.includes(x)) : false;
    }).length;
  const front = count(FRONTLINE);
  const back = count(BACKLINE);
  const isFront = card.professions.some((x) => FRONTLINE.includes(x));
  const isBack = card.professions.some((x) => BACKLINE.includes(x));
  let score = 0;
  if (isFront && front < 3) score += 6;
  if (isBack && back < 3) score += 6;
  if (isFront && front >= 4) score -= 3;
  if (isBack && back >= 4) score -= 3;
  return score;
}

/** 购买评分（纯函数，便于单测） */
export function slotScore(p: PlayerState, configId: string, round: number, snap?: TraitSnapshot): number {
  const card = configOf(configId);
  if (!card) return -Infinity;
  const s = snap ?? traitSnapshotOf(p);
  let score = baseScore(card);
  score += traitScore(s, card);
  score += compositionScore(p, card);

  // 合成价值：已有 2 张 → 立刻三合一
  const copies = copyCount(p, configId);
  if (copies >= 2) score += 30;
  else if (copies === 1) score += 5;

  // 费用修正：前期更看重便宜牌
  score -= card.price * (round <= 5 ? 0.9 : 0.4);

  // 手牌拥堵惩罚
  if (p.hand.length >= shopConfig.handLimit - 3) score -= 8;
  if (p.hand.length >= shopConfig.handLimit - 1) score -= 25;
  return score;
}

export function copyCount(p: PlayerState, configId: string): number {
  const onHand = p.hand.filter((c) => c.configId === configId).length;
  const onBoard = p.board.filter((c) => c !== null && c.configId === configId).length;
  return onHand + onBoard;
}

function canAfford(p: PlayerState, configId: string): boolean {
  const config = configOf(configId);
  if (!config) return false;
  return p.gold >= config.price && p.hand.length < shopConfig.handLimit;
}

/* ══════════════ 站位（纯函数） ══════════════ */

/** 英雄的主定位：刺客 > 前排 > 后排 */
export function roleOf(card: CardConfig): "assassin" | "front" | "back" {
  if (card.professions.includes("assassin")) return "assassin";
  if (card.professions.some((x) => FRONTLINE.includes(x))) return "front";
  return "back";
}

/** 对手后排压力最大的列（0/1/2），无信息时取中间列 */
export function enemyBacklineColumn(state: GameState, pid: number): number {
  const lastId = state.lastOpponent[pid];
  const opp =
    (lastId != null ? state.players[lastId] : undefined) ??
    state.players.find((x) => x.id !== pid && !x.eliminated);
  const weight = [0, 0, 0];
  if (opp) {
    for (const c of opp.board) {
      if (!c || c.position === null || c.position < 4) continue;
      const col = (c.position - 1) % 3;
      weight[col] = (weight[col] ?? 0) + totalAtk(c);
    }
  }
  let best = 1;
  for (let i = 0; i < 3; i++) {
    if ((weight[i] ?? 0) > (weight[best] ?? 0)) best = i;
  }
  return best;
}

/** 期望的落位顺序（6 个位置，从最想到最不想） */
export function positionOrder(state: GameState, pid: number, card: CardConfig): number[] {
  const role = roleOf(card);
  if (role === "assassin") {
    const col = enemyBacklineColumn(state, pid);
    const preferred = [col + 1, col + 4];
    return [...preferred, ...[1, 2, 3, 4, 5, 6].filter((x) => !preferred.includes(x))];
  }
  if (role === "front") return [1, 2, 3, 4, 5, 6];
  return [4, 5, 6, 1, 2, 3];
}

/** 该卡的最佳空位；棋盘已满返回 null */
export function choosePosition(state: GameState, p: PlayerState, card: CardInstance): number | null {
  const cfg = configOf(card.configId);
  if (!cfg) return null;
  for (const pos of positionOrder(state, p.id, cfg)) {
    if (p.board[pos - 1] === null) return pos;
  }
  return null;
}

/* ══════════════ 卖牌判定 ══════════════ */

/** 手牌里最没有价值的一星散牌（不拆对子）；返回 null 表示没有可卖的 */
export function worstHandCard(p: PlayerState): CardInstance | null {
  const candidates = p.hand.filter((c) => c.level === 1 && copyCount(p, c.configId) === 1);
  if (candidates.length === 0) return null;
  return candidates.reduce((worst, c) => {
    const a = cardScoreOf(p, c);
    const b = cardScoreOf(p, worst);
    if (a < b) return c;
    if (a === b && c.uid < worst.uid) return c; // 同分按 uid 破同分
    return worst;
  });
}

export function cardScoreOf(p: PlayerState, card: CardInstance): number {
  const cfg = configOf(card.configId);
  if (!cfg) return -Infinity;
  const levelBonus = card.level === 2 ? 20 : 0;
  return baseScore(cfg) + levelBonus + totalAtk(card) * 0.5 + totalHp(card) * 0.3;
}

/** 棋盘上最弱的一星卡（用于替换） */
export function worstBoardCard(p: PlayerState): CardInstance | null {
  const candidates = p.board.filter((c): c is CardInstance => c !== null && c.level === 1);
  if (candidates.length === 0) return null;
  return candidates.reduce((worst, c) => (cardScoreOf(p, c) < cardScoreOf(p, worst) ? c : worst));
}

/* ══════════════ 决策 ══════════════ */

/** 创建一个带独立随机源的 AI（每个玩家一个实例） */
export function createBot(seed: number, playerId: number): Bot {
  const rng: Rng = createRng((seed + playerId * 0x9e3779b9) >>> 0);
  const stats: BotStats = { buys: 0, sells: 0, refreshes: 0, upgrades: 0, moves: 0, equips: 0 };

  return {
    stats,
    decide(state: GameState, pid: number): Action {
      const p = state.players[pid]!;
      const snap = traitSnapshotOf(p);
      const filled = [0, 1, 2].filter((i) => p.shop[i] !== null);
      const affordable = filled.filter((i) => canAfford(p, p.shop[i]!));

      // 1. 优先完成三合一（已有 2 张同名）
      const trioSlot = affordable.find((i) => copyCount(p, p.shop[i]!) === 2);
      if (trioSlot !== undefined) {
        stats.buys += 1;
        return { type: "buy", player: pid, shopIndex: trioSlot as 0 | 1 | 2 };
      }

      // 1b. 武器：凑齐三张同名优先买；否则给空装备栏的英雄补一件
      const weaponSlot = affordable.find((i) => {
        const cfg = configOf(p.shop[i]!);
        return cfg?.type === "weapon";
      });
      if (weaponSlot !== undefined && p.weapons.length < shopConfig.weaponLimit) {
        const cfg = configOf(p.shop[weaponSlot]!)!;
        const sameOwned = p.weapons.filter((w) => w.configId === cfg.id).length;
        const idleHero = [...p.board.filter((c): c is CardInstance => c !== null), ...p.hand].some(
          (c) => hasFreeEquipSlot(c) && configOf(c.configId)?.type === "hero",
        );
        // 已有 1 张就继续凑（2 张时上面 trioSlot 已处理）；或场上还有没装备的英雄
        if (sameOwned >= 1 || idleHero) {
          stats.buys += 1;
          return { type: "buy", player: pid, shopIndex: weaponSlot as 0 | 1 | 2 };
        }
      }

      // 1c. 装备武器：优先给没装备的英雄，其次给"换上更好的"收益最大的英雄
      if (p.weapons.length > 0) {
        const heroes = [...p.board.filter((c): c is CardInstance => c !== null), ...p.hand].filter(
          (c) => configOf(c.configId)?.type === "hero",
        );
        if (heroes.length > 0) {
          let best: { weaponUid: number; cardUid: number; gain: number } | null = null;
          for (const w of p.weapons) {
            for (const hero of heroes) {
              const free = hasFreeEquipSlot(hero);
              // 有空槽：空槽本身就是 0，任何武器都是净收益（只要有一点就装）
              // 满槽：和身上最弱的一件比，且要求明显更强，避免来回换
              const baseline = free ? 0 : weaponScore(hero.equips.reduce((a, b) => (weaponScore(b) < weaponScore(a) ? b : a)));
              const gain = weaponScore(w) - baseline;
              const need = free ? 1 : 6;
              if (gain >= need && (best === null || gain > best.gain)) {
                best = { weaponUid: w.uid, cardUid: hero.uid, gain };
              }
            }
          }
          if (best) {
            stats.equips += 1;
            return { type: "equip", player: pid, weaponUid: best.weaponUid, cardUid: best.cardUid };
          }
        }
      }

      // 2. 手牌拥堵：先清掉最没用的散牌
      if (p.hand.length >= shopConfig.handLimit - 2) {
        const junk = worstHandCard(p);
        if (junk) {
          stats.sells += 1;
          return { type: "sell", player: pid, cardUid: junk.uid };
        }
      }

      // 3. 升级商店：按回合推进目标等级（前期铺场，中后期解锁紫/橙卡）
      //    目标等级参考同类自走棋节奏：R1-2 → L2，R3-4 → L3，R5-7 → L4，R8+ → L5
      const targetLevel = state.round <= 2 ? 2 : state.round <= 4 ? 3 : state.round <= 7 ? 4 : 5;
      const gap = goldToUpgrade(p.shopLevel, p.exp);
      const boardCount = p.board.filter((c) => c !== null).length;
      if (
        gap !== null &&
        gap > 0 &&
        p.shopLevel < targetLevel &&
        p.gold >= gap &&
        boardCount >= 2
      ) {
        stats.upgrades += 1;
        return { type: "upgradeShop", player: pid };
      }

      // 4. 买评分最高的槽位（不再只买第一个买得起的）
      if (affordable.length > 0 && p.hand.length < shopConfig.handLimit) {
        const ranked = affordable
          .map((i) => ({ i, score: slotScore(p, p.shop[i]!, state.round, snap) }))
          .sort((a, b) => b.score - a.score || a.i - b.i);
        if (ranked[0]!.score > 0) {
          stats.buys += 1;
          return { type: "buy", player: pid, shopIndex: ranked[0]!.i as 0 | 1 | 2 };
        }
      }

      // 5. 上阵 / 换位（万能牌不上阵）
      const idle = p.hand
        .filter((c) => c.position === null && configOf(c.configId)?.type !== "duplicator")
        .sort((a, b) => cardScoreOf(p, b) - cardScoreOf(p, a) || a.uid - b.uid);
      for (const card of idle) {
        const pos = choosePosition(state, p, card);
        if (pos !== null) {
          stats.moves += 1;
          return { type: "move", player: pid, cardUid: card.uid, position: pos };
        }
      }

      // 5b. 棋盘已满：用更强的手牌替换最弱的一星
      if (idle.length > 0) {
        const worst = worstBoardCard(p);
        if (worst && cardScoreOf(p, idle[0]!) > cardScoreOf(p, worst) + 6) {
          stats.sells += 1;
          return { type: "sell", player: pid, cardUid: worst.uid };
        }
      }

      // 6. 刷新：免费刷新优先；否则少量概率（花掉多余金币，避免金币溢出浪费）
      if (p.freeRefresh > 0 && p.hand.length < shopConfig.handLimit) {
        stats.refreshes += 1;
        return { type: "refresh", player: pid };
      }
      if (
        p.gold >= shopConfig.refreshCost + 4 &&
        p.hand.length < shopConfig.handLimit - 2 &&
        rng() < 0.35
      ) {
        stats.refreshes += 1;
        return { type: "refresh", player: pid };
      }

      // 7. 结束商店阶段
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

/** 便捷工具：某玩家当前已激活的羁绊（CLI/测试统计用） */
export function activeTraitIds(p: PlayerState): TraitId[] {
  const snap = traitSnapshotOf(p);
  const out: TraitId[] = [];
  for (const [id, count] of snap.counts) {
    const cfg = TRAIT_BY_ID.get(id);
    if (cfg && count >= cfg.thresholds[0]) out.push(id);
  }
  return out.sort();
}
