/**
 * Web 入口：会话 + 交互接线
 * 流程：商店阶段操作 → 点【准备】→ 展示对手与先手后手 → 点【开战】→ 我的战斗逐回合动画 → 下一回合
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

let selectedUid: number | null = null;

function renderAll(): void {
  renderTopbar(session.state);
  renderOppStrip(session.state);
  renderShop(session.state, onBuy);
  renderShopButtons(session.state, onRefresh, onUpgrade);
  renderBoard(session.state, selectedUid, onSlot, onSelect);
  renderHand(session.state, selectedUid, onSelect, onSell, onCancel);
  renderReadyButton(session.state, onReady);
}

/** 执行玩家操作：失败弹提示；三合一弹横幅 */
function act(action: Parameters<GameSession["act"]>[0]): void {
  try {
    const events = session.act(action);
    for (const e of events) {
      if (e.type === "COMBINE") showToast("✨ 三合一！金卡诞生");
    }
  } catch (err) {
    showToast(`操作失败：${(err as Error).message}`);
  }
  renderAll();
}

function onBuy(idx: number): void {
  act({ type: "buy", player: 0, shopIndex: idx as 0 | 1 | 2 });
}

function onRefresh(): void {
  act({ type: "refresh", player: 0 });
}

function onUpgrade(): void {
  act({ type: "upgradeShop", player: 0 });
}

function onSelect(uid: number): void {
  selectedUid = selectedUid === uid ? null : uid;
  renderAll();
}

function onCancel(): void {
  selectedUid = null;
  renderAll();
}

function onSell(uid: number): void {
  act({ type: "sell", player: 0, cardUid: uid });
  selectedUid = null;
}

function onSlot(pos: number): void {
  if (selectedUid === null) {
    showToast("先点击仓库或场上的一张卡，再点击目标位置");
    return;
  }
  act({ type: "move", player: 0, cardUid: selectedUid, position: pos });
  selectedUid = null;
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
