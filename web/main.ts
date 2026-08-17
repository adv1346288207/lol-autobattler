/**
 * Web 入口：会话 + 交互接线
 */
import { GameSession } from "./session";
import {
  buildUidNameMap,
  hideOverlay,
  renderActionBar,
  renderBoard,
  renderHand,
  renderOpponents,
  renderShop,
  renderTopbar,
  showBattleOverlay,
  showFinalOverlay,
  showToast,
} from "./ui";

const params = new URLSearchParams(location.search);
const seed = Number(params.get("seed")) || Math.floor(Math.random() * 1_000_000);
const session = new GameSession(seed);

let selectedUid: number | null = null;

function renderAll(): void {
  renderTopbar(session.state, seed);
  renderOpponents(session.state);
  renderShop(session.state, onBuy);
  renderHand(session.state, selectedUid, onSelect, onSell);
  renderBoard(session.state, selectedUid, onSlot, onSelect);
  renderActionBar(session.state, {
    refresh: () => act({ type: "refresh", player: 0 }),
    upgrade: () => act({ type: "upgradeShop", player: 0 }),
    buyexp: () => act({ type: "buyExp", player: 0 }),
    endTurn: onEndTurn,
  });
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

function onSelect(uid: number): void {
  selectedUid = selectedUid === uid ? null : uid;
  renderAll();
}

function onSell(uid: number): void {
  act({ type: "sell", player: 0, cardUid: uid });
  selectedUid = null;
}

function onSlot(pos: number): void {
  if (selectedUid === null) {
    showToast("先点击手牌或场上的一张卡，再点击目标位置");
    return;
  }
  act({ type: "move", player: 0, cardUid: selectedUid, position: pos });
  selectedUid = null;
}

function onEndTurn(): void {
  if (session.state.phase !== "shop") return;
  const events = session.endTurn();
  if (session.isOver) {
    renderAll();
    showFinalOverlay(session.finalRanking(), () => location.reload());
    return;
  }
  showBattleOverlay(events, buildUidNameMap(session.state), () => {
    hideOverlay();
    renderAll();
  });
}

renderAll();
