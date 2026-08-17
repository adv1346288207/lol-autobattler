/**
 * Web 渲染层（DOM 构建；零游戏逻辑）
 * 与 CLI 渲染层平级——替换渲染层即可换平台
 */
import type { BattleEvent, CardInstance, GameState, PlayerState } from "../core/state";
import { CARD_BY_ID } from "../config/cards";
import { expToUpgrade } from "../config/economy";
import { shopConfig } from "../config/shop";

const QUALITY_CLASS: Record<string, string> = {
  green: "q-green",
  blue: "q-blue",
  purple: "q-purple",
  orange: "q-orange",
  gold: "q-gold",
};

const QUALITY_LABEL: Record<string, string> = {
  green: "绿",
  blue: "蓝",
  purple: "紫",
  orange: "橙",
  gold: "金",
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function cardName(c: CardInstance): string {
  return CARD_BY_ID.get(c.configId)?.name ?? c.configId;
}

/** uid → 卡牌名 的查找表（战斗日志用） */
export function buildUidNameMap(state: GameState): Map<number, string> {
  const map = new Map<number, string>();
  for (const p of state.players) {
    for (const c of [...p.hand, ...p.board]) {
      if (c) map.set(c.uid, cardName(c));
    }
  }
  return map;
}

export function renderCard(c: CardInstance, extraClass = ""): HTMLElement {
  const config = CARD_BY_ID.get(c.configId)!;
  const node = el("div", `card ${QUALITY_CLASS[config.quality]} ${extraClass}`);
  node.dataset.uid = String(c.uid);
  node.appendChild(el("div", "card-name", config.name));
  if (c.level === 2) node.appendChild(el("div", "card-gold", "★金"));
  const stats = el("div", "card-stats");
  stats.appendChild(el("span", "atk", `攻${c.atk}`));
  stats.appendChild(el("span", "hp", `血${c.hp}`));
  node.appendChild(stats);
  node.appendChild(el("div", "card-qual", `${QUALITY_LABEL[config.quality]}·${config.price}金`));
  return node;
}

export function renderTopbar(state: GameState, seed: number): void {
  const bar = document.getElementById("topbar")!;
  bar.replaceChildren();
  const p = state.players[0]!;
  const cost = expToUpgrade(p.shopLevel);
  bar.appendChild(el("span", "title", `悠悠牌 MVP · 第 ${state.round} 回合`));
  bar.appendChild(
    el(
      "span",
      "info",
      `商店Lv${p.shopLevel} · 金币 ${p.gold} · 经验 ${p.exp}${cost !== null ? `/${cost}` : "（满级）"} · 免费刷新 ${p.freeRefresh}`,
    ),
  );
}

export function renderOpponents(state: GameState): void {
  const box = document.getElementById("opponents")!;
  box.replaceChildren();
  for (const p of state.players) {
    const tile = el("div", `opp ${p.eliminated ? "opp-dead" : ""} ${p.id === 0 ? "opp-me" : ""}`);
    const hpPct = Math.max(0, Math.min(100, (p.hp / 30) * 100));
    const label = p.id === 0 ? "你" : `玩家${p.id}`;
    tile.appendChild(el("div", "opp-label", label));
    const bar = el("div", "opp-hpbar");
    bar.appendChild(el("div", "opp-hpfill", `${p.hp}`));
    (bar.firstChild as HTMLElement).style.width = `${hpPct}%`;
    tile.appendChild(bar);
    if (p.rank !== null) tile.appendChild(el("div", "opp-rank", `第${p.rank}名`));
    box.appendChild(tile);
  }
}

export function renderShop(state: GameState, onBuy: (idx: number) => void): void {
  const box = document.getElementById("shop")!;
  box.replaceChildren();
  const p = state.players[0]!;
  const title = el("div", "section-title", "商店");
  box.appendChild(title);
  const row = el("div", "shop-row");
  p.shop.forEach((id, i) => {
    const slot = el("div", "shop-slot");
    if (id === null) {
      slot.appendChild(el("div", "slot-empty", "已售空"));
    } else {
      const config = CARD_BY_ID.get(id)!;
      const card = el("div", `card ${QUALITY_CLASS[config.quality]}`);
      card.appendChild(el("div", "card-name", config.name));
      const stats = el("div", "card-stats");
      stats.appendChild(el("span", "atk", `攻${config.atk}`));
      stats.appendChild(el("span", "hp", `血${config.hp}`));
      card.appendChild(stats);
      card.appendChild(el("div", "card-qual", `${QUALITY_LABEL[config.quality]}·${config.price}金`));
      card.dataset.shop = String(i);
      card.addEventListener("click", () => onBuy(i));
      if (p.gold < config.price || p.hand.length >= shopConfig.handLimit) card.classList.add("disabled");
      slot.appendChild(card);
    }
    row.appendChild(slot);
  });
  box.appendChild(row);
}

export function renderHand(state: GameState, selectedUid: number | null, onSelect: (uid: number) => void, onSell: (uid: number) => void): void {
  const box = document.getElementById("hand")!;
  box.replaceChildren();
  const p = state.players[0]!;
  box.appendChild(el("div", "section-title", `手牌（${p.hand.length}/${shopConfig.handLimit}）`));
  const row = el("div", "hand-row");
  for (const c of p.hand) {
    const card = renderCard(c, c.uid === selectedUid ? "selected" : "");
    card.addEventListener("click", () => onSelect(c.uid));
    row.appendChild(card);
  }
  if (selectedUid !== null) {
    const sellBtn = el("button", "btn btn-danger", "出售选中卡");
    sellBtn.addEventListener("click", () => onSell(selectedUid));
    row.appendChild(sellBtn);
  }
  if (p.hand.length === 0) row.appendChild(el("div", "empty-hint", "（空）"));
  box.appendChild(row);
}

export function renderBoard(
  state: GameState,
  selectedUid: number | null,
  onSlot: (pos: number) => void,
  onSelect: (uid: number) => void,
): void {
  const box = document.getElementById("board")!;
  box.replaceChildren();
  box.appendChild(el("div", "section-title", "棋盘（上排=前排 1~3，下排=后排 4~6）"));
  const grid = el("div", "board-grid");
  for (const pos of [1, 2, 3, 4, 5, 6]) {
    const slot = el("div", "board-slot");
    slot.dataset.pos = String(pos);
    const c = state.players[0]!.board[pos - 1];
    if (c) {
      const card = renderCard(c, c.uid === selectedUid ? "selected" : "");
      card.addEventListener("click", (e) => {
        e.stopPropagation();
        onSelect(c.uid);
      });
      slot.appendChild(card);
    } else {
      slot.appendChild(el("div", "slot-empty", `${pos}`));
    }
    slot.addEventListener("click", () => onSlot(pos));
    grid.appendChild(slot);
  }
  box.appendChild(grid);
}

export function renderActionBar(
  state: GameState,
  actions: { refresh: () => void; upgrade: () => void; buyexp: () => void; endTurn: () => void },
): void {
  const bar = document.getElementById("actionbar")!;
  bar.replaceChildren();
  const p = state.players[0]!;
  const inShop = state.phase === "shop" && !p.shopDone;

  const btnRefresh = el("button", "btn", `刷新${shopConfig.refreshCost}金${p.freeRefresh > 0 ? `（免费×${p.freeRefresh}）` : ""}`);
  btnRefresh.disabled = !inShop;
  btnRefresh.addEventListener("click", actions.refresh);
  bar.appendChild(btnRefresh);

  const cost = expToUpgrade(p.shopLevel);
  const btnUp = el("button", "btn", cost === null ? "已满级" : `升级商店（需${cost}经验）`);
  btnUp.disabled = !inShop || cost === null || p.exp < cost;
  btnUp.addEventListener("click", actions.upgrade);
  bar.appendChild(btnUp);

  const btnExp = el("button", "btn", "买经验（2金）");
  btnExp.disabled = !inShop || p.gold < 2;
  btnExp.addEventListener("click", actions.buyexp);
  bar.appendChild(btnExp);

  const btnEnd = el("button", "btn btn-primary", "结束回合 ▶");
  btnEnd.disabled = !inShop;
  btnEnd.addEventListener("click", actions.endTurn);
  bar.appendChild(btnEnd);
}

export function showBattleOverlay(events: BattleEvent[], names: Map<number, string>, onClose: () => void): void {
  const overlay = document.getElementById("overlay")!;
  overlay.replaceChildren();
  overlay.classList.remove("hidden");
  const panel = el("div", "overlay-panel");
  panel.appendChild(el("div", "overlay-title", "⚔ 战斗回放"));
  const log = el("div", "battle-log");

  const name = (uid: number) => names.get(uid) ?? `#${uid}`;
  let i = 0;
  for (const e of events) {
    let line = "";
    switch (e.type) {
      case "BATTLE_START":
        line = `⚔ 玩家${e.a} vs 玩家${e.b}`;
        break;
      case "ATTACK":
        line = `${name(e.from)} → ${name(e.to)}　-${e.dmg}`;
        break;
      case "DEATH":
        line = `☠ ${name(e.who)} 阵亡`;
        break;
      case "COMBINE":
        line = `✨ 三合一！${CARD_BY_ID.get(e.configId)?.name ?? ""}金卡诞生`;
        break;
      case "BATTLE_END":
        if (e.winner === null) line = `⚖ 平局（双方各扣3）`;
        else {
          const hp = e.survivors.reduce((s, x) => s + x.hp, 0);
          line = `🏆 玩家${e.winner} 胜（存活血量 ${hp}）`;
        }
        break;
    }
    const row = el("div", "battle-line", line);
    row.style.setProperty("--i", String(i));
    i++;
    log.appendChild(row);
  }
  panel.appendChild(log);
  const btn = el("button", "btn btn-primary overlay-close", "继续 ▶");
  btn.addEventListener("click", onClose);
  panel.appendChild(btn);
  overlay.appendChild(panel);
}

export function showFinalOverlay(ranking: PlayerState[], onRestart: () => void): void {
  const overlay = document.getElementById("overlay")!;
  overlay.replaceChildren();
  overlay.classList.remove("hidden");
  const panel = el("div", "overlay-panel");
  panel.appendChild(el("div", "overlay-title", "🏆 对局结束"));
  const list = el("div", "final-list");
  for (const p of ranking) {
    const row = el("div", p.id === 0 ? "final-row final-me" : "final-row");
    row.appendChild(el("span", "final-rank", `第${p.rank}名`));
    row.appendChild(el("span", "final-name", p.id === 0 ? "你" : `玩家${p.id}`));
    row.appendChild(el("span", "final-hp", `剩余血量 ${p.hp}`));
    list.appendChild(row);
  }
  panel.appendChild(list);
  const btn = el("button", "btn btn-primary overlay-close", "再来一局 ↻");
  btn.addEventListener("click", onRestart);
  panel.appendChild(btn);
  overlay.appendChild(panel);
}

export function hideOverlay(): void {
  const overlay = document.getElementById("overlay")!;
  overlay.classList.add("hidden");
}

export function showToast(msg: string): void {
  const toast = document.getElementById("toast")!;
  toast.textContent = msg;
  toast.classList.remove("hidden");
  window.clearTimeout((toast as unknown as { _t?: number })._t);
  (toast as unknown as { _t?: number })._t = window.setTimeout(() => toast.classList.add("hidden"), 2000);
}
