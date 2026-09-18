/**
 * 三合一合成
 * - 只在购买阶段执行；每次"获得卡牌/武器"后调用
 * - 二星（level 2）为最高级，不可再合成
 * - 二星属性：攻击 = 三张之和，血量 = 三张之和（含万能牌自身数值）
 * - 英雄在场上位置 1→6 扫描，最后检查纯仓库三张；武器只在武器库存里合成
 * - 合成时被吃掉的英雄身上如果有装备，装备会退回武器库存（不凭空消失）
 *
 * 万能牌分两条线，互不通用：
 * - 英雄线「英雄复制器」（wildcard: "role"）
 * - 武器线「海克斯科技枪刃」（wildcard: "weapon"）
 * 英雄线沿用旧规则：只有"1 个位置持有 + 仓库 1 张"才用万能牌补齐，两个位置持有同卡时不补齐。
 * 武器线更宽松：只要同线万能牌能凑满 3 张即可（2 真 + 1 金，或 1 真 + 2 金）。
 */
import type { BattleEvent, CardInstance, EquipInstance, GameState, PlayerState } from "./state";
import { EQUIP_SLOTS } from "./state";
import { CARD_BY_ID, isWildcardCard } from "../config/cards";

/** 该卡属于哪条万能线（武器卡走武器线，其余走英雄线） */
function wildcardKindFor(configId: string): "role" | "weapon" {
  return CARD_BY_ID.get(configId)?.type === "weapon" ? "weapon" : "role";
}

function removeInstance(player: PlayerState, card: CardInstance): void {
  const handIdx = player.hand.findIndex((c) => c.uid === card.uid);
  if (handIdx >= 0) {
    player.hand.splice(handIdx, 1);
    return;
  }
  const boardIdx = player.board.findIndex((c) => c !== null && c.uid === card.uid);
  if (boardIdx >= 0) {
    player.board[boardIdx] = null;
    return;
  }
  throw new Error(`combine: 找不到卡牌实例 uid=${card.uid}`);
}

/** 被合成吃掉的卡：装备退回武器库存，避免数值凭空消失 */
function refundEquip(player: PlayerState, card: CardInstance): void {
  if (card.equips.length === 0) return;
  player.weapons.push(...card.equips);
  card.equips = [];
}

/** 合并三张英雄为二星（anchor 留在 anchorPos，其余两张消失） */
function mergeThree(
  state: GameState,
  player: PlayerState,
  anchor: CardInstance,
  b: CardInstance,
  c: CardInstance,
  anchorPos: number | null,
): BattleEvent {
  // 锚点身上的装备跟着新卡走（最多 EQUIP_SLOTS 件，多出来的退回库存）
  const kept = anchor.equips.slice(0, EQUIP_SLOTS);
  const overflow = anchor.equips.slice(EQUIP_SLOTS);
  const gold: CardInstance = {
    uid: state.nextUid++,
    configId: anchor.configId,
    level: 2,
    atk: anchor.atk + b.atk + c.atk,
    hp: anchor.hp + b.hp + c.hp,
    position: anchorPos,
    isFreeRefreshUsed: false,
    equips: kept,
    // 成长属性跟着合并累加，不然合一次就把攒的成长吃掉
    growthAtk: anchor.growthAtk + b.growthAtk + c.growthAtk,
    growthHp: anchor.growthHp + b.growthHp + c.growthHp,
  };
  anchor.equips = [];
  if (overflow.length > 0) player.weapons.push(...overflow);
  refundEquip(player, b);
  refundEquip(player, c);
  removeInstance(player, anchor);
  removeInstance(player, b);
  removeInstance(player, c);
  if (anchorPos === null) {
    gold.position = null;
    player.hand.push(gold);
  } else {
    player.board[anchorPos - 1] = gold;
  }
  return { type: "COMBINE", cardUid: gold.uid, configId: anchor.configId };
}

/** 场上同 configId 的一星卡（按位置 1→6 顺序） */
function sameOnBoard(player: PlayerState, configId: string, excludeUid: number): CardInstance[] {
  return player.board.filter(
    (c): c is CardInstance => c !== null && c.level === 1 && c.configId === configId && c.uid !== excludeUid,
  );
}

function sameInHand(player: PlayerState, configId: string): CardInstance[] {
  return player.hand.filter((c) => c.level === 1 && c.configId === configId);
}

/**
 * 以 anchor 为核心，挑出另外两张参与合成的卡；凑不齐返回 null。
 * 先用真卡，再用同线万能牌补位。
 */
function pickPartners(player: PlayerState, anchor: CardInstance): CardInstance[] | null {
  const kind = wildcardKindFor(anchor.configId);
  const onBoardOthers = sameOnBoard(player, anchor.configId, anchor.uid);
  const inHandOthers = sameInHand(player, anchor.configId);
  const realOthers = [...onBoardOthers, ...inHandOthers];
  const wilds = player.hand.filter((c) => c.level === 1 && isWildcardCard(c.configId, kind));

  // 1) 三张真卡（任意分布）
  if (realOthers.length >= 2) return realOthers.slice(0, 2);

  // 2) 用万能牌补齐
  //    武器线：只要总数够 3 且至少 1 张真卡
  //    英雄线：沿用旧规则——锚点必须是场上唯一一张，且仓库里至少 1 张真卡
  const wildAllowed = kind === "weapon" || onBoardOthers.length === 0;
  if (!wildAllowed) return null;
  if (kind !== "weapon" && realOthers.length < 1) return null;
  const pool = [...realOthers, ...wilds];
  if (pool.length < 2) return null;
  return pool.slice(0, 2);
}

/** 武器合成：三张同名（可用金武器补齐）→ 二星武器，攻击/生命为三张之和 */
function runWeaponCombine(player: PlayerState): BattleEvent | null {
  const byConfig = new Map<string, EquipInstance[]>();
  for (const w of player.weapons) {
    if (w.level !== 1 || isWildcardCard(w.configId, "weapon")) continue;
    const arr = byConfig.get(w.configId) ?? [];
    arr.push(w);
    byConfig.set(w.configId, arr);
  }
  const wilds = player.weapons.filter((w) => w.level === 1 && isWildcardCard(w.configId, "weapon"));
  for (const [configId, arr] of byConfig) {
    const need = 3 - arr.length;
    if (need > wilds.length) continue;
    const used = [...arr.slice(0, 3), ...wilds.slice(0, Math.max(0, need))];
    const gold: EquipInstance = {
      uid: arr[0]!.uid,
      configId,
      level: 2,
      atk: used.reduce((s, w) => s + w.atk, 0),
      hp: used.reduce((s, w) => s + w.hp, 0),
    };
    // 移除参与合成的武器（gold 复用第一个的 uid）
    const ids = new Set(used.map((w) => w.uid));
    player.weapons = player.weapons.filter((w) => !ids.has(w.uid));
    player.weapons.push(gold);
    return { type: "COMBINE", cardUid: gold.uid, configId };
  }
  return null;
}

/**
 * 对某玩家执行全部可执行的三合一（购买阶段调用；幂等）
 * 返回 COMBINE 事件列表（供渲染层/回放）
 */
export function runCombineChecks(state: GameState, player: PlayerState): BattleEvent[] {
  const events: BattleEvent[] = [];
  let merged = true;
  while (merged) {
    merged = false;

    // ── 情形 A/B：场上位置 1→6 扫描（锚点优先） ──
    for (let pos = 1; pos <= 6; pos++) {
      const anchor = player.board[pos - 1];
      if (!anchor || anchor.level !== 1 || isWildcardCard(anchor.configId)) continue;
      const partners = pickPartners(player, anchor);
      if (partners && partners.length === 2) {
        events.push(mergeThree(state, player, anchor, partners[0]!, partners[1]!, pos));
        merged = true;
        break; // 重新从头扫描（场上位置可能空出）
      }
    }
    if (merged) continue;

    // ── 情形 C：仓库 3 张真卡（场上无锚点）──
    const counts = new Map<string, CardInstance[]>();
    for (const c of player.hand) {
      if (c.level !== 1 || isWildcardCard(c.configId)) continue;
      const arr = counts.get(c.configId) ?? [];
      arr.push(c);
      counts.set(c.configId, arr);
    }
    for (const arr of counts.values()) {
      if (arr.length >= 3) {
        events.push(mergeThree(state, player, arr[0]!, arr[1]!, arr[2]!, null));
        merged = true;
        break;
      }
    }
    if (merged) continue;

    // ── 情形 D：武器库存三合一 ──
    const weaponEvent = runWeaponCombine(player);
    if (weaponEvent) {
      events.push(weaponEvent);
      merged = true;
    }
  }
  return events;
}
