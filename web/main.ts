/**
 * Web 入口：会话 + 拖动交互
 * 交互模型（用户指定 2026-08-17）：
 *   - 商店卡【拖出】= 购买：拖到棋盘槽落位 / 拖到仓库入仓库；轻微动（<10px）不算购买
 *   - 手牌/场上卡拖动：→ 棋盘槽 = 上阵/交换；→ 仓库 = 回手牌；→ 商店 = 售出
 */
import { GameSession } from "./session";
import {
  renderBoard,
  renderHand,
  renderOppStrip,
  renderReadyButton,
  renderShop,
  renderShopButtons,
  renderTopbar,
  showBattleView,
  showFinalOverlay,
  showPrepareOverlay,
  showToast,
} from "./ui";
import type { BattleEvent } from "../core/state";

const params = new URLSearchParams(location.search);
const seed = Number(params.get("seed")) || Math.floor(Math.random() * 1_000_000);
const session = new GameSession(seed);

const DRAG_THRESHOLD = 10; // 拖动超过 10px 才算拖动

interface DragRef {
  source: "shop" | "hand" | "board";
  uid: number | null; // hand/board 卡的 uid
  shopIndex: number | null; // shop 槽位
}

interface DragState extends DragRef {
  startX: number;
  startY: number;
  moved: boolean;
  ghost: HTMLElement | null;
}

let drag: DragState | null = null;

function renderAll(): void {
  renderTopbar(session.state);
  renderOppStrip(session.state);
  renderShop(session.state, (idx, e) => onCardDown(e, { source: "shop", uid: null, shopIndex: idx }));
  renderShopButtons(session.state, onRefresh, onUpgrade);
  renderBoard(session.state, (uid, e) => onCardDown(e, { source: "board", uid, shopIndex: null }));
  renderHand(session.state, (uid, e) => onCardDown(e, { source: "hand", uid, shopIndex: null }));
  renderReadyButton(session.state, onReady);
}

/** 执行玩家操作：失败弹提示；三合一弹横幅 */
function act(action: Parameters<GameSession["act"]>[0]): boolean {
  try {
    const events = session.act(action);
    for (const e of events) {
      if (e.type === "COMBINE") showToast("✨ 三合一！金卡诞生");
    }
    return true;
  } catch (err) {
    showToast(`操作失败：${(err as Error).message}`);
    return false;
  }
}

/* ══════════ 拖动系统 ══════════ */

function onCardDown(e: PointerEvent, ref: DragRef): void {
  if (session.state.phase !== "shop" || session.player.shopDone) return;
  e.preventDefault();
  drag = { ...ref, startX: e.clientX, startY: e.clientY, moved: false, ghost: null };
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp, { once: true });
}

function onPointerMove(e: PointerEvent): void {
  if (!drag) return;
  if (!drag.moved) {
    const dist = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
    if (dist < DRAG_THRESHOLD) return; // 轻微动不算拖动
    drag.moved = true;
    const origin = document.elementFromPoint(drag.startX, drag.startY)?.closest(".card");
    if (origin) {
      const ghost = origin.cloneNode(true) as HTMLElement;
      ghost.classList.add("drag-ghost");
      document.body.appendChild(ghost);
      drag.ghost = ghost;
    }
  }
  if (drag.ghost) {
    drag.ghost.style.left = `${e.clientX}px`;
    drag.ghost.style.top = `${e.clientY}px`;
  }
}

function onPointerUp(e: PointerEvent): void {
  window.removeEventListener("pointermove", onPointerMove);
  const d = drag;
  drag = null;
  if (!d) return;
  if (d.ghost) d.ghost.remove();
  if (!d.moved) return; // 未形成拖动 → 无操作

  const target = document.elementFromPoint(e.clientX, e.clientY);
  if (!target) return;
  const slotEl = target.closest("[data-pos]") as HTMLElement | null;
  const handEl = target.closest("#hand");
  const shopEl = target.closest("#shop");

  if (d.source === "shop") {
    // 商店卡拖出 = 购买
    if (d.shopIndex === null) return;
    if (slotEl) {
      buyAndPlace(d.shopIndex, Number(slotEl.dataset.pos));
    } else if (handEl) {
      if (act({ type: "buy", player: 0, shopIndex: d.shopIndex as 0 | 1 | 2 })) renderAll();
    }
    // 拖回商店 = 取消
    return;
  }

  // 手牌/场上卡
  if (d.uid === null) return;
  if (slotEl) {
    const pos = Number(slotEl.dataset.pos);
    // 场上卡拖回原位置 = 无操作
    const onBoard = session.player.board.find((c) => c !== null && c.uid === d.uid);
    if (onBoard && onBoard.position === pos) return;
    if (act({ type: "move", player: 0, cardUid: d.uid, position: pos })) renderAll();
  } else if (handEl) {
    // 场上卡 → 回手牌（手牌卡拖到仓库 = 无操作）
    if (d.source === "board") {
      if (act({ type: "move", player: 0, cardUid: d.uid, position: 0 })) renderAll();
    }
  } else if (shopEl) {
    // 拖到商店 = 售出
    if (act({ type: "sell", player: 0, cardUid: d.uid })) renderAll();
  }
}

/** 商店卡拖到棋盘：先购买再上阵（刚买的卡 uid 为手牌中 position=null 且 uid 最大者） */
function buyAndPlace(shopIndex: number, pos: number): void {
  if (!act({ type: "buy", player: 0, shopIndex: shopIndex as 0 | 1 | 2 })) return;
  const candidates = session.player.hand.filter((c) => c.position === null);
  if (candidates.length === 0) {
    // 购买后即合成（落到场上/仓库），无需再上阵
    renderAll();
    return;
  }
  const newest = candidates.reduce((a, b) => (a.uid > b.uid ? a : b));
  if (act({ type: "move", player: 0, cardUid: newest.uid, position: pos })) renderAll();
}

/* ══════════ 按钮操作 ══════════ */

function onRefresh(): void {
  if (act({ type: "refresh", player: 0 })) renderAll();
}

function onUpgrade(): void {
  if (act({ type: "upgradeShop", player: 0 })) renderAll();
}

/** 点【准备】：AI 行动 + 配对 → 展示对手与先手后手 */
function onReady(): void {
  if (session.state.phase !== "shop" || session.player.shopDone) return;
  const preview = session.prepareTurn();

  if (preview.opponentId === null) {
    // 轮空：无战斗，直接结算进下一回合
    session.fightTurn();
    if (session.isOver) {
      renderAll();
      showFinalOverlay(session.finalRanking(), () => location.reload());
    } else {
      showToast("😴 你本轮轮空");
      renderAll();
    }
    return;
  }
  showPrepareOverlay(preview, onFight);
}

/** 点【开战】：结算战斗 → 只展示"我"的那场对战 */
function onFight(): void {
  const log = session.fightTurn();
  if (session.isOver) {
    renderAll();
    showFinalOverlay(session.finalRanking(), () => location.reload());
    return;
  }
  const mine = extractMyBattle(log);
  if (mine) {
    showBattleView(mine, () => renderAll());
  } else {
    renderAll();
  }
}

/** 从全回合日志中切出玩家 0 的那场对战（BATTLE_START..BATTLE_END） */
function extractMyBattle(log: BattleEvent[]): BattleEvent[] | null {
  const startIdx = log.findIndex((e) => e.type === "BATTLE_START" && (e.a === 0 || e.b === 0));
  if (startIdx < 0) return null;
  const endIdx = log.findIndex((e, i) => i > startIdx && e.type === "BATTLE_END");
  if (endIdx < 0) return null;
  return log.slice(startIdx, endIdx + 1);
}

renderAll();
