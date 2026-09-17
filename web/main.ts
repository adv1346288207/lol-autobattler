/**
 * Web 入口：开始界面 → 匹配选图 → 对局（拖动交互 + 各类弹窗）
 *
 * 交互模型：
 *   - 商店卡【拖出】= 购买：拖到棋盘槽落位 / 拖到仓库入仓库；轻微动（<10px）不算购买
 *   - 手牌/场上卡拖动：→ 棋盘槽 = 上阵/交换；→ 仓库 = 回手牌；→ 商店 = 售出
 *   - 轻点卡牌 = 卡牌详情（含二星预览）；轻点对手头像 = 上回合阵容；轻点羁绊 = 羁绊阵营与效果
 *   - 拖动时高亮可落位的棋盘槽
 */
import { GameSession } from "./session";
import {
  boardPower,
  hideDetail,
  renderBoard,
  renderHand,
  renderOppStrip,
  renderReadyButton,
  renderShop,
  renderShopButtons,
  renderTopbar,
  renderTraits,
  showBattleView,
  showCardDetail,
  showCompendium,
  showFinalOverlay,
  showMatchScreen,
  showOpponentDetail,
  showPrepareOverlay,
  showSettings,
  showShopOdds,
  showStartScreen,
  showToast,
  showTraitDetail,
  traitRowsOf,
  type MatchScreen,
} from "./ui";
import { CARD_BY_ID } from "../config/cards";
import { MAP_BY_ID, MAP_IDS, mapName, pickMapForSeed, tallyMapVotes, type MapId } from "../config/maps";
import type { BattleEvent, CardInstance } from "../core/state";
import { totalAtk, totalHp, hasFreeEquipSlot } from "../core/state";

const params = new URLSearchParams(location.search);
const seed = Number(params.get("seed")) || Math.floor(Math.random() * 1_000_000);
const QUICK = params.get("quick") === "1";
const SKIP_ROUNDS = Math.max(0, Math.min(40, Number(params.get("skip")) || 0));
const SHOW_BATTLE = params.get("battle") === "1";
const FORCE_WIDTH = Number(params.get("w")) || 0;
const MATCH_SECONDS = Math.max(1, Math.min(10, Number(params.get("matchsec")) || 5));

if (FORCE_WIDTH >= 320 && FORCE_WIDTH <= 560) {
  // 桌面浏览器里模拟窄屏手机（无头浏览器无法把视口压到 400px 以下）
  document.getElementById("app")?.style.setProperty("max-width", `${FORCE_WIDTH}px`);
}

const DRAG_THRESHOLD = 10;
const ME = 0;

let session: GameSession | null = null;
let matchScreen: MatchScreen | null = null;
let matchVote: MapId | null = null;
let matchCountdown = MATCH_SECONDS;
let matchTick: number | undefined;
let vsId: number | null = null;
let lastTraitTiers = new Map<string, number>();

function st() {
  if (!session) throw new Error("对局尚未开始");
  return session;
}

interface DragRef {
  source: "shop" | "hand" | "board" | "weapon";
  uid: number | null;
  shopIndex: number | null;
  configId: string;
}

interface DragState extends DragRef {
  startX: number;
  startY: number;
  moved: boolean;
  ghost: HTMLElement | null;
  hoverSlot: HTMLElement | null;
}

let drag: DragState | null = null;

/* ══════════ 渲染 ══════════ */

function traitTierMap(): Map<string, number> {
  const map = new Map<string, number>();
  if (!session) return map;
  for (const row of traitRowsOf(session.player)) map.set(row.id, row.tier);
  return map;
}

/** 对比羁绊变化并弹出提示 */
function announceTraits(): void {
  const now = traitTierMap();
  const messages: string[] = [];
  for (const [id, tier] of now) {
    const before = lastTraitTiers.get(id) ?? -1;
    if (tier > before) {
      const name = traitNameOf(id);
      messages.push(tier === 1 ? `🔥 ${name} 4 人档激活！` : `✨ ${name} 2 人档激活`);
    }
  }
  lastTraitTiers = now;
  if (messages.length > 0) showToast(messages.join("　"));
}

function traitNameOf(id: string): string {
  return traitRowsOf(st().player).find((r) => r.id === id)?.name ?? id;
}

function renderAll(announce = false): void {
  const sess = st();
  const s = sess.state;
  renderTopbar(s, {
    onOdds: () => showShopOdds(s),
    onMap: () => {
      const map = s.mapId ? MAP_BY_ID.get(s.mapId) : null;
      showToast(map ? `${map.name}：${map.desc}` : "本局无地图加成");
    },
    onSettings: () =>
      showSettings({
        onExitToMenu: exitToMenu,
        onRestart: () => location.reload(),
        onCompendium: () => showCompendium("all", sess.player),
      }),
    onCodex: () => showCompendium("all", sess.player),
  });
  renderOppStrip(s, vsId, (id) => showOpponentDetail(s, id));
  renderShop(s, (idx, e) => onCardDown(e, shopRef(idx)), onShopTap);
  renderShopButtons(s, onRefresh, onUpgrade);
  renderTraits(s, (id) => showTraitDetail(id, sess.player));
  renderBoard(s, (uid, e) => onCardDown(e, cardRef("board", uid)), onCardTap);
  renderHand(s, (uid, e) => onCardDown(e, cardRef("hand", uid)), onCardTap, (uid, e) => onWeaponDown(e, uid), onWeaponTap);
  renderReadyButton(s, onReady, readyHint());
  if (announce) announceTraits();
  else lastTraitTiers = traitTierMap();
}

function readyHint(): string {
  const p = st().player;
  if (p.shopDone) return "等待结算…";
  return `我方战力 ${boardPower(p)}　·　点【准备】开战`;
}

function shopRef(idx: number): DragRef {
  const id = st().player.shop[idx];
  return { source: "shop", uid: null, shopIndex: idx, configId: id ?? "" };
}

function cardRef(source: "hand" | "board", uid: number): DragRef {
  const card = findCard(uid);
  return { source, uid, shopIndex: null, configId: card?.configId ?? "" };
}

function findCard(uid: number): CardInstance | null {
  const p = st().player;
  return [...p.hand, ...p.board].find((c): c is CardInstance => c !== null && c.uid === uid) ?? null;
}

function act(action: Parameters<GameSession["act"]>[0]): boolean {
  try {
    const events = st().act(action);
    for (const e of events) {
      if (e.type === "COMBINE") showToast("✨ 三合一！金卡诞生");
    }
    return true;
  } catch (err) {
    showToast(`操作失败：${(err as Error).message}`);
    return false;
  }
}

/* ══════════ 点击 = 查看详情 ══════════ */

function onShopTap(idx: number): void {
  if (tapSuppressed()) return;
  const s = st();
  if (s.state.phase !== "shop") return;
  const id = s.player.shop[idx];
  if (!id) return;
  if (CARD_BY_ID.has(id)) showCardDetail(id, { player: s.player });
}

/**
 * 拖动结束后浏览器仍会在"按下和抬起落在同一个元素"时补一个 click。
 * 如果不抑制，把卡拖出去又拖回原处松手 → 详情弹窗会莫名其妙弹出来。
 */
let suppressTapUntil = 0;
function suppressTap(ms = 320): void {
  suppressTapUntil = performance.now() + ms;
}
function tapSuppressed(): boolean {
  return performance.now() < suppressTapUntil;
}

function onCardTap(uid: number): void {
  if (tapSuppressed()) return;
  const card = findCard(uid);
  if (!card) return;
  showCardDetail(card.configId, {
    level: card.level,
    atk: totalAtk(card),
    hp: totalHp(card),
    equips: card.equips,
    player: st().player,
    uid: card.uid,
    onUnequip: (weaponUid) => {
      if (act({ type: "unequip", player: ME, cardUid: card.uid, weaponUid })) {
        renderAll(true);
        showToast("已卸下武器，回到武器库");
      }
    },
  });
}

/* ══════════ 武器：拖动装备 ══════════ */

function onWeaponTap(uid: number): void {
  if (tapSuppressed()) return;
  const w = st().player.weapons.find((x) => x.uid === uid);
  if (!w) return;
  showCardDetail(w.configId, { level: w.level, atk: w.atk, hp: w.hp, player: st().player });
}

function onWeaponDown(e: PointerEvent, uid: number): void {
  const s = st();
  if (s.state.phase !== "shop" || s.player.shopDone) return;
  e.preventDefault();
  const w = s.player.weapons.find((x) => x.uid === uid);
  drag = {
    source: "weapon",
    uid,
    shopIndex: null,
    configId: w?.configId ?? "",
    startX: e.clientX,
    startY: e.clientY,
    moved: false,
    ghost: null,
    hoverSlot: null,
  };
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp, { once: true });
}

/* ══════════ 拖动 ══════════ */

function onCardDown(e: PointerEvent, ref: DragRef): void {
  const s = st();
  if (s.state.phase !== "shop" || s.player.shopDone) return;
  e.preventDefault();
  drag = { ...ref, startX: e.clientX, startY: e.clientY, moved: false, ghost: null, hoverSlot: null };
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp, { once: true });
}

function clearHover(): void {
  if (drag?.hoverSlot) {
    drag.hoverSlot.classList.remove("drop-hover");
    drag.hoverSlot = null;
  }
}

function onPointerMove(e: PointerEvent): void {
  if (!drag) return;
  if (!drag.moved) {
    const dist = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
    if (dist < DRAG_THRESHOLD) return;
    drag.moved = true;
    hideDetail();
    // 拖拽幽灵：卡牌和武器都要有（"逮住"的物体要跟着手走）
    const origin = document.elementFromPoint(drag.startX, drag.startY)?.closest(".card, .bench-weapon");
    if (origin) {
      const rect = origin.getBoundingClientRect();
      const ghost = origin.cloneNode(true) as HTMLElement;
      ghost.classList.add("drag-ghost");
      // 显式给尺寸：武器芯片原本是 height:100% + aspect-ratio，直接克隆到 body 下会算不出大小
      ghost.style.width = `${rect.width}px`;
      ghost.style.height = `${rect.height}px`;
      document.body.appendChild(ghost);
      drag.ghost = ghost;
    }
  }
  if (drag.ghost) {
    drag.ghost.style.left = `${e.clientX}px`;
    drag.ghost.style.top = `${e.clientY}px`;
  }
  const target = document.elementFromPoint(e.clientX, e.clientY);
  clearHover();
  if (!target) return;

  if (drag.source === "weapon") {
    // 武器：高亮可装备的英雄卡
    const cardEl = target.closest("[data-uid]") as HTMLElement | null;
    const uid = cardEl ? Number(cardEl.dataset.uid) : NaN;
    const hero = Number.isNaN(uid) ? null : findCard(uid);
    if (cardEl && hero && CARD_BY_ID.get(hero.configId)?.type === "hero") {
      cardEl.classList.add("drop-hover");
      drag.hoverSlot = cardEl;
    }
    return;
  }

  const slot = (target.closest("[data-pos]") as HTMLElement | null) ?? null;
  if (slot && !slot.querySelector(".card")) {
    slot.classList.add("drop-hover");
    drag.hoverSlot = slot;
  }
}

function onPointerUp(e: PointerEvent): void {
  window.removeEventListener("pointermove", onPointerMove);
  const d = drag;
  drag = null;
  if (!d) return;
  clearHover();
  if (d.ghost) d.ghost.remove();

  if (!d.moved) {
    if (d.source === "shop" && d.shopIndex !== null) onShopTap(d.shopIndex);
    else if (d.source === "weapon" && d.uid !== null) onWeaponTap(d.uid);
    else if (d.uid !== null) onCardTap(d.uid);
    return;
  }
  suppressTap(); // 真拖动：抑制浏览器补发的那次 click

  const target = document.elementFromPoint(e.clientX, e.clientY);
  if (!target) return;
  const slotEl = target.closest("[data-pos]") as HTMLElement | null;
  const handEl = target.closest("#hand");
  const shopEl = target.closest("#shop");

  // 武器：拖到英雄身上装备，拖到商店出售
  if (d.source === "weapon") {
    if (d.uid === null) return;
    if (shopEl) {
      if (act({ type: "sell", player: ME, cardUid: d.uid })) renderAll(true);
      return;
    }
    const cardEl = target.closest("[data-uid]") as HTMLElement | null;
    const cardUid = cardEl ? Number(cardEl.dataset.uid) : NaN;
    if (Number.isNaN(cardUid)) return;
    const hero = findCard(cardUid);
    if (!hero || CARD_BY_ID.get(hero.configId)?.type !== "hero") {
      showToast("武器只能装备到英雄身上");
      return;
    }
    if (act({ type: "equip", player: ME, weaponUid: d.uid, cardUid })) {
      renderAll(true);
      showToast(`已装备：${CARD_BY_ID.get(hero.configId)?.name ?? hero.configId}`);
    }
    return;
  }

  if (d.source === "shop") {
    if (d.shopIndex === null) return;
    const cfgId = st().player.shop[d.shopIndex];
    const cfg = cfgId ? CARD_BY_ID.get(cfgId) : null;

    // 武器：拖到英雄身上 = 一次买下并装备；拖到别处 = 买进武器库
    if (cfg?.type === "weapon") {
      const cardEl = target.closest("[data-uid]") as HTMLElement | null;
      const cardUid = cardEl ? Number(cardEl.dataset.uid) : NaN;
      const hero = Number.isNaN(cardUid) ? null : findCard(cardUid);
      if (!act({ type: "buy", player: ME, shopIndex: d.shopIndex as 0 | 1 | 2 })) return;
      if (hero && CARD_BY_ID.get(hero.configId)?.type === "hero") {
        // uid 单调递增：最新买到的武器就是 uid 最大的那件
        const fresh = st()
          .player.weapons.filter((w) => w.configId === cfg.id)
          .sort((a, b) => b.uid - a.uid)[0];
        if (fresh) act({ type: "equip", player: ME, weaponUid: fresh.uid, cardUid });
      }
      renderAll(true);
      return;
    }

    if (slotEl) {
      buyAndPlace(d.shopIndex, Number(slotEl.dataset.pos));
    } else if (handEl) {
      if (act({ type: "buy", player: ME, shopIndex: d.shopIndex as 0 | 1 | 2 })) renderAll(true);
    }
    return;
  }

  if (d.uid === null) return;
  if (slotEl) {
    const pos = Number(slotEl.dataset.pos);
    const onBoard = st().player.board.find((c) => c !== null && c.uid === d.uid);
    if (onBoard && onBoard.position === pos) return;
    if (act({ type: "move", player: ME, cardUid: d.uid, position: pos })) renderAll(true);
  } else if (handEl) {
    if (d.source === "board") {
      if (act({ type: "move", player: ME, cardUid: d.uid, position: 0 })) renderAll(true);
    }
  } else if (shopEl) {
    if (act({ type: "sell", player: ME, cardUid: d.uid })) renderAll(true);
  }
}

function buyAndPlace(shopIndex: number, pos: number): void {
  if (!act({ type: "buy", player: ME, shopIndex: shopIndex as 0 | 1 | 2 })) return;
  const candidates = st().player.hand.filter((c) => c.position === null && CARD_BY_ID.get(c.configId)?.type !== "duplicator");
  if (candidates.length === 0) {
    renderAll(true);
    return;
  }
  const newest = candidates.reduce((a, b) => (a.uid > b.uid ? a : b));
  if (act({ type: "move", player: ME, cardUid: newest.uid, position: pos })) renderAll(true);
}

/* ══════════ 按钮 ══════════ */

function onRefresh(): void {
  if (act({ type: "refresh", player: ME })) renderAll(true);
}

function onUpgrade(): void {
  if (act({ type: "upgradeShop", player: ME })) renderAll(true);
}

/**
 * 一场战斗打完后统一收尾。
 * ⚠️ 人类出局后必须**立刻快进到终局并弹名次面板**——否则对局还在继续（AI 互打），
 * 而玩家的【准备】按钮因为 shopDone=true 永久禁用，界面就卡死了。
 * @returns true = 对局已结束（调用方不要再继续渲染商店流程）
 */
function afterBattle(): boolean {
  const s = st();
  const meOut = s.player.eliminated;
  if (!meOut && !s.isOver) return false;
  if (!s.isOver) s.endTurn(); // 已经出局→自动打完剩下的回合
  renderAll();
  showFinalOverlay(s.finalRanking(), () => location.reload(), ME);
  return true;
}

function onReady(): void {
  const s = st();
  if (s.state.phase !== "shop" || s.player.shopDone) return;
  const preview = s.prepareTurn();
  vsId = preview.opponentId;
  renderOppStrip(s.state, vsId, (id) => showOpponentDetail(s.state, id));

  if (preview.opponentId === null) {
    s.fightTurn();
    if (afterBattle()) return;
    showToast("😴 你本轮轮空");
    vsId = null;
    renderAll();
    return;
  }
  showPrepareOverlay(preview, onFight, s.state);
}

function onFight(): void {
  const s = st();
  const log = s.fightTurn();
  if (afterBattle()) return;
  const mine = extractMyBattle(log);
  if (mine) {
    showBattleView(
      mine,
      () => {
        vsId = null;
        renderAll();
      },
      ME,
    );
  } else {
    vsId = null;
    renderAll();
  }
}

function extractMyBattle(log: BattleEvent[]): BattleEvent[] | null {
  const startIdx = log.findIndex((e) => e.type === "BATTLE_START" && (e.a === ME || e.b === ME));
  if (startIdx < 0) return null;
  const endIdx = log.findIndex((e, i) => i > startIdx && e.type === "BATTLE_END");
  if (endIdx < 0) return null;
  return log.slice(startIdx, endIdx + 1);
}

/* ══════════ 开始界面 / 匹配选图 ══════════ */

function readRecord(): { bestRank: number | null; played: number } {
  try {
    const raw = localStorage.getItem("lolcodex.record");
    if (!raw) return { bestRank: null, played: 0 };
    const parsed = JSON.parse(raw) as { bestRank?: number; played?: number };
    return { bestRank: parsed.bestRank ?? null, played: parsed.played ?? 0 };
  } catch {
    return { bestRank: null, played: 0 };
  }
}

function saveRecord(rank: number | null): void {
  try {
    const prev = readRecord();
    const best = rank === null ? prev.bestRank : Math.min(prev.bestRank ?? 99, rank);
    localStorage.setItem("lolcodex.record", JSON.stringify({ bestRank: best, played: prev.played + 1 }));
  } catch {
    /* 隐私模式忽略 */
  }
}

function showStart(): void {
  showStartScreen(readRecord(), {
    onMatch: startMatching,
    onCodex: () => showCompendium("all"),
    onHelp: () => showToast("拖动商店卡购买 · 轻点卡牌看详情 · 轻点对手看阵容 · 轻点羁绊看阵营"),
  });
}

/** 退出当前对局回到主菜单：保留战绩记录，重置对局状态 */
function exitToMenu(): void {
  window.clearInterval(matchTick);
  matchScreen?.close();
  matchScreen = null;
  session = null;
  vsId = null;
  drag = null;
  lastTraitTiers = new Map();
  // 清掉对局界面残留
  for (const id of ["topbar", "opps", "shop", "shopbtns", "traits", "board", "hand", "detail", "overlay"]) {
    document.getElementById(id)?.replaceChildren();
  }
  document.getElementById("overlay")?.classList.add("hidden");
  hideDetail();
  showStart();
}

function startMatching(): void {
  matchVote = null;
  matchCountdown = MATCH_SECONDS;
  matchScreen = showMatchScreen(MATCH_SECONDS, {
    onVote: (id) => {
      matchVote = id;
      refreshVote();
    },
    onFinish: (picked) => finishMatch(picked),
  });
  refreshVote();
  window.clearInterval(matchTick);
  matchTick = window.setInterval(() => {
    matchCountdown -= 1;
    if (matchCountdown <= 0) {
      window.clearInterval(matchTick);
      matchCountdown = 0;
    }
    refreshVote();
  }, 1000);
}

/** 逐步揭晓 8 名玩家的投票（每秒 2 票），让匹配阶段有过程感 */
function refreshVote(): void {
  const full = tallyMapVotes(seed, matchVote);
  const revealedCount = Math.min(full.votes.length, (MATCH_SECONDS - matchCountdown) * 2 + 1);
  const tally: Record<string, number> = {};
  for (const id of MAP_IDS) tally[id] = 0;
  const revealedVotes: (MapId | null)[] = Array.from({ length: full.votes.length }, () => null);
  for (let i = 0; i < revealedCount; i++) {
    const v = full.votes[i]!;
    tally[v] = (tally[v] ?? 0) + 1;
    revealedVotes[i] = v;
  }
  matchScreen?.update({
    secondsLeft: matchCountdown,
    picked: matchVote,
    tally,
    revealedVotes,
    winner: matchCountdown <= 0 ? full.winner : null,
  });
}

function finishMatch(picked: MapId | null): void {
  window.clearInterval(matchTick);
  const result = tallyMapVotes(seed, picked);
  matchScreen?.close();
  matchScreen = null;
  startGame(result.winner);
  showToast(`本局地图：${mapName(result.winner)}`);
}

/* ══════════ 开局 ══════════ */

function startGame(mapId: MapId): void {
  session = new GameSession(seed, mapId);
  lastTraitTiers = traitTierMap();
  if (SKIP_ROUNDS > 0) runSkipMode();
  else renderAll();

  if (SHOW_BATTLE && !st().isOver) {
    // 预览：最多推进 3 回合，直到玩家这一轮真的打上一场（避免轮空时截不到战斗界面）
    for (let i = 0; i < 3 && !st().isOver; i++) {
      const preview = st().prepareTurn();
      vsId = preview.opponentId;
      const log = st().fightTurn();
      const mine = extractMyBattle(log);
      if (mine) {
        renderAll();
        showBattleView(mine, () => renderAll(), ME);
        return;
      }
      if (st().isOver) break;
    }
    renderAll();
    return;
  }

  // 开发/截图用：?panel=trait:demacia | opp:2 | card:ahri | odds
  const panel = params.get("panel");
  if (panel) openDevPanel(panel);
}

function openDevPanel(spec: string): void {
  const [kind, arg] = spec.split(":");
  const s = st();
  if (kind === "trait" && arg) showTraitDetail(arg, s.player);
  else if (kind === "opp") showOpponentDetail(s.state, Number(arg ?? 1));
  else if (kind === "card" && arg) {
    // 优先打开场上/仓库里的真实实例（这样能看到装备与实时数值）
    const card = [...s.player.board, ...s.player.hand].find((c) => c !== null && c.configId === arg);
    if (card) onCardTap(card.uid);
    else showCardDetail(arg, { player: s.player });
  } else if (kind === "odds") showShopOdds(s.state);
  else if (kind === "codex") showCompendium((arg as "all" | "hero" | "weapon") ?? "all", s.player);
  else if (kind === "settings")
    showSettings({ onExitToMenu: exitToMenu, onRestart: () => location.reload(), onCompendium: () => showCompendium("all") });
}

/** 预览模式：替玩家自动买牌上阵并推进 N 回合（开发/截图用） */
function runSkipMode(): void {
  for (let i = 0; i < SKIP_ROUNDS && !st().isOver; i++) {
    autoPlayHuman();
    st().endTurn();
  }
  renderAll();
  // 直接跑到分出胜负时，顺手验证终局面板
  if (st().isOver) showFinalOverlay(st().finalRanking(), () => location.reload(), ME);
}

function autoPlayHuman(): void {
  const p = st().player;
  for (let guard = 0; guard < 80 && !p.shopDone; guard++) {
    // 先装备武器（仓库有货且场上有空槽的英雄）；?noequip=1 用于截图查看仓库里的武器
    const bare = params.get("noequip")
      ? undefined
      : [...p.board.filter((c): c is CardInstance => c !== null), ...p.hand].find(
          (c) => hasFreeEquipSlot(c) && CARD_BY_ID.get(c.configId)?.type === "hero",
        );
    if (p.weapons.length > 0 && bare) {
      const w = p.weapons.reduce((a, b) => (b.atk * 2 + b.hp > a.atk * 2 + a.hp ? b : a));
      try {
        st().act({ type: "equip", player: ME, weaponUid: w.uid, cardUid: bare.uid });
        continue;
      } catch {
        /* 忽略 */
      }
    }
    // 预览模式里优先买一件武器，用来验证装备栏与卡面武器条
    if (p.weapons.length === 0) {
      const wi = p.shop.findIndex(
        (id) => id !== null && CARD_BY_ID.get(id)?.type === "weapon" && CARD_BY_ID.get(id)!.price <= p.gold,
      );
      if (wi >= 0) {
        try {
          st().act({ type: "buy", player: ME, shopIndex: wi as 0 | 1 | 2 });
          continue;
        } catch {
          /* 忽略 */
        }
      }
    }
    const idx = p.shop.findIndex((id) => id !== null && (CARD_BY_ID.get(id)?.price ?? 99) <= p.gold);
    if (idx >= 0) {
      try {
        st().act({ type: "buy", player: ME, shopIndex: idx as 0 | 1 | 2 });
        continue;
      } catch {
        /* 买不动就继续 */
      }
    }
    const idle = p.hand.find((c) => c.position === null && CARD_BY_ID.get(c.configId)?.type !== "duplicator");
    const empty = p.board.findIndex((c) => c === null);
    if (idle && empty >= 0) {
      try {
        st().act({ type: "move", player: ME, cardUid: idle.uid, position: empty + 1 });
        continue;
      } catch {
        /* 忽略 */
      }
    }
    try {
      st().act({ type: "endShop", player: ME });
    } catch {
      /* 已结束 */
    }
    break;
  }
}

/* ══════════ 启动 ══════════ */

if (params.get("screen") === "match") {
  // 开发/截图用：直接进入匹配选图
  startMatching();
} else if (params.get("screen") === "codex") {
  // 开发/截图用：主菜单上直接打开图鉴（验证层级）
  showStart();
  showCompendium(params.get("tab") === "weapon" ? "weapon" : "all");
} else if (QUICK || SKIP_ROUNDS > 0 || SHOW_BATTLE) {
  // 预览/调试：跳过开始界面与选图，直接用 seed 决定地图
  startGame(pickMapForSeed(seed));
} else {
  showStart();
}
