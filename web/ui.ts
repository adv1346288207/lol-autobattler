/**
 * Web 渲染层（DOM 构建；零游戏逻辑）
 * 布局（用户指定 2026-08-17）：顶栏等级+经验差 → 对手条 → 商店3卡 → 刷新/升级按钮
 *   → 2×3 棋盘 → 底部仓库横滑条 + 准备圆按钮
 */
import type { BattleEvent, BattleUnitSnapshot, CardInstance, GameState, PlayerState } from "../core/state";
import { CARD_BY_ID } from "../config/cards";
import { expToUpgrade, goldToUpgrade } from "../config/economy";
import { shopConfig } from "../config/shop";
import type { TurnPreview } from "./session";

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

function cardName(c: CardInstance | { uid: number; configId: string }): string {
  return CARD_BY_ID.get(c.configId)?.name ?? c.configId;
}

/* ══════════════ 商店阶段渲染 ══════════════ */

export function renderTopbar(state: GameState): void {
  const bar = document.getElementById("topbar")!;
  bar.replaceChildren();
  const p = state.players[0]!;
  const cost = expToUpgrade(p.shopLevel);
  const gap = cost === null ? null : Math.max(0, cost - p.exp);

  const row = el("div", "toprow");
  const info = el("div", "top-info");
  info.appendChild(el("span", "lv", `商店Lv${p.shopLevel}`));
  if (gap === null) {
    info.appendChild(el("span", "exp-gap", " · 已到最高级"));
  } else {
    info.appendChild(el("span", "exp-gap", ` · 距升级差 `));
    const b = el("b", undefined, `${gap} 经验`);
    info.appendChild(b);
    info.appendChild(el("span", "exp-gap", `（补 ${gap} 金币）`));
  }
  row.appendChild(info);

  const res = el("div", "res");
  res.appendChild(el("div", undefined, `💰 金币 ${p.gold}　🔄 免费刷新 ${p.freeRefresh}`));
  res.appendChild(el("div", "round", `第 ${state.round} 回合`));
  row.appendChild(res);
  bar.appendChild(row);
}

export function renderOppStrip(state: GameState): void {
  const box = document.getElementById("opps")!;
  box.replaceChildren();
  for (const p of state.players) {
    const tile = el("div", `opp ${p.eliminated ? "opp-dead" : ""} ${p.id === 0 ? "opp-me" : ""}`);
    tile.appendChild(el("div", undefined, p.id === 0 ? "你" : `P${p.id}`));
    const hp = el("div", "opp-hp");
    const fill = el("div", "opp-hpfill");
    fill.style.width = `${Math.max(0, Math.min(100, (p.hp / 30) * 100))}%`;
    hp.appendChild(fill);
    tile.appendChild(hp);
    if (p.rank !== null) tile.appendChild(el("div", "opp-rank", `${p.rank}`));
    box.appendChild(tile);
  }
}

export function renderShop(state: GameState, onCardDown: (idx: number, e: PointerEvent) => void): void {
  const box = document.getElementById("shop")!;
  box.replaceChildren();
  const p = state.players[0]!;
  const row = el("div", "shop-row");
  p.shop.forEach((id, i) => {
    const slot = el("div", "shop-slot");
    if (id === null) {
      const empty = el("div", "card disabled");
      empty.appendChild(el("div", "card-name", "已售空"));
      slot.appendChild(empty);
    } else {
      const config = CARD_BY_ID.get(id)!;
      const card = el("div", `card ${QUALITY_CLASS[config.quality]}`);
      card.appendChild(el("div", "card-name", config.name));
      const stats = el("div", "card-stats");
      stats.appendChild(el("span", "atk", `攻${config.atk}`));
      stats.appendChild(el("span", "hp", `血${config.hp}`));
      card.appendChild(stats);
      card.appendChild(el("div", "card-qual", `${QUALITY_LABEL[config.quality]}·${config.price}金`));
      card.addEventListener("pointerdown", (e) => onCardDown(i, e));
      if (p.gold < config.price || p.hand.length >= shopConfig.handLimit) card.classList.add("disabled");
      slot.appendChild(card);
    }
    row.appendChild(slot);
  });
  box.appendChild(row);
}

export function renderShopButtons(
  state: GameState,
  onRefresh: () => void,
  onUpgrade: () => void,
): void {
  const box = document.getElementById("shopbtns")!;
  box.replaceChildren();
  const p = state.players[0]!;
  const row = el("div", "btnrow");

  // 左：刷新（有免费刷新则显示 0 金币）
  const btnRefresh = el(
    "button",
    "btn",
    p.freeRefresh > 0 ? `刷新（免费×${p.freeRefresh}）` : `刷新 ${shopConfig.refreshCost}金币`,
  );
  btnRefresh.disabled = p.freeRefresh <= 0 && p.gold < shopConfig.refreshCost;
  btnRefresh.addEventListener("click", onRefresh);
  row.appendChild(btnRefresh);

  // 右：升级（自动升级后经验恒小于所需，按钮永远显示"补差金币"）
  const gap = goldToUpgrade(p.shopLevel, p.exp);
  let btnUp: HTMLButtonElement;
  if (gap === null) {
    btnUp = el("button", "btn btn-up", "已到最高级");
    btnUp.disabled = true;
  } else {
    btnUp = el("button", "btn btn-up", `升级商店（补 ${gap} 金币）`);
    btnUp.disabled = p.gold < gap;
  }
  btnUp.addEventListener("click", onUpgrade);
  row.appendChild(btnUp);
  box.appendChild(row);
}

export function renderBoard(
  state: GameState,
  onCardDown: (uid: number, e: PointerEvent) => void,
): void {
  const box = document.getElementById("board")!;
  box.replaceChildren();
  const grid = el("div", "board-grid");
  for (const pos of [1, 2, 3, 4, 5, 6]) {
    const slot = el("div", "board-slot");
    slot.dataset.pos = String(pos);
    slot.appendChild(el("div", "slot-pos", `${pos}${pos <= 3 ? "前" : "后"}`));
    const c = state.players[0]!.board[pos - 1];
    if (c) {
      const card = renderCard(c);
      card.addEventListener("pointerdown", (e) => onCardDown(c.uid, e));
      slot.appendChild(card);
    } else {
      slot.appendChild(el("div", "slot-empty", "空"));
    }
    grid.appendChild(slot);
  }
  box.appendChild(grid);
}

export function renderHand(
  state: GameState,
  onCardDown: (uid: number, e: PointerEvent) => void,
): void {
  const box = document.getElementById("hand")!;
  box.replaceChildren();
  const p = state.players[0]!;
  if (p.hand.length === 0) {
    box.appendChild(el("div", "empty-hint", `仓库（${p.hand.length}/${shopConfig.handLimit}）`));
  }
  for (const c of p.hand) {
    const card = renderCard(c);
    card.addEventListener("pointerdown", (e) => onCardDown(c.uid, e));
    box.appendChild(card);
  }
}

export function renderReadyButton(state: GameState, onReady: () => void): void {
  const btn = document.getElementById("ready") as HTMLButtonElement;
  btn.disabled = state.phase !== "shop" || state.players[0]!.shopDone;
  btn.onclick = onReady;
}

export function renderCard(c: CardInstance, extraClass = ""): HTMLElement {
  const config = CARD_BY_ID.get(c.configId)!;
  const node = el("div", `card ${QUALITY_CLASS[config.quality]} ${extraClass}`);
  node.appendChild(el("div", "card-name", config.name));
  if (c.level === 2) node.appendChild(el("div", "card-gold", "★金"));
  const stats = el("div", "card-stats");
  stats.appendChild(el("span", "atk", `攻${c.atk}`));
  stats.appendChild(el("span", "hp", `血${c.hp}`));
  node.appendChild(stats);
  node.appendChild(el("div", "card-qual", `${QUALITY_LABEL[config.quality]}`));
  return node;
}

/* ══════════════ 准备阶段（开战前知道对手与先手后手） ══════════════ */

export function showPrepareOverlay(preview: TurnPreview, onFight: () => void): void {
  const overlay = getOverlay();
  overlay.replaceChildren();
  overlay.classList.remove("hidden");
  const panel = el("div", "overlay-panel");
  panel.appendChild(el("div", "overlay-title", "⚔ 对手匹配"));

  const row = el("div", "prepare-row");
  row.appendChild(el("span", undefined, `对手：玩家${preview.opponentId}`));
  const badge = el(
    "span",
    preview.amFirst ? "prepare-badge prepare-first" : "prepare-badge prepare-second",
    preview.amFirst ? "你 · 先手" : "你 · 后手",
  );
  row.appendChild(badge);
  panel.appendChild(row);

  const fight = el("button", "btn overlay-close", "开战 ▶");
  fight.style.cssText = "width:100%; padding:12px; font-size:15px;";
  fight.addEventListener("click", () => {
    overlay.classList.add("hidden");
    onFight();
  });
  panel.appendChild(fight);
  overlay.appendChild(panel);
}

/* ══════════════ 战斗展示（我的对战：敌方上、我方下、逐回合动画） ══════════════ */

interface UnitView {
  uid: number;
  name: string;
  atk: number;
  hp: number;
  maxHp: number;
  root: HTMLElement;
  hpFill: HTMLElement;
  hpText: HTMLElement;
}

const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

export function showBattleView(events: BattleEvent[], onDone: () => void): void {
  const overlay = getOverlay();
  overlay.replaceChildren();
  overlay.classList.remove("hidden");
  const start = events[0]!;
  if (start.type !== "BATTLE_START") throw new Error("showBattleView: 事件流缺少 BATTLE_START");
  const meSide: "a" | "b" = start.a === 0 ? "a" : "b";
  const enemySide: "a" | "b" = meSide === "a" ? "b" : "a";
  const boards: { a: BattleUnitSnapshot[]; b: BattleUnitSnapshot[] } = start.boards;

  const root = el("div", "battle-root");
  const units = new Map<number, UnitView>();

  function makeUnit(snap: { uid: number; configId: string; level: 1 | 2; atk: number; hp: number }): HTMLElement {
    const config = CARD_BY_ID.get(snap.configId)!;
    const unit = el("div", `battle-unit ${QUALITY_CLASS[config.quality]}`);
    unit.appendChild(el("div", "bu-name", `${config.name}${snap.level === 2 ? "★" : ""}`));
    unit.appendChild(el("div", "bu-atk", `攻${snap.atk}`));
    const hpbar = el("div", "bu-hpbar");
    const hpFill = el("div", "bu-hpfill");
    hpFill.style.width = "100%";
    hpbar.appendChild(hpFill);
    unit.appendChild(hpbar);
    const hpText = el("div", "bu-hptext", `${snap.hp}/${snap.hp}`);
    unit.appendChild(hpText);
    units.set(snap.uid, {
      uid: snap.uid,
      name: config.name,
      atk: snap.atk,
      hp: snap.hp,
      maxHp: snap.hp,
      root: unit,
      hpFill,
      hpText,
    });
    return unit;
  }

  function buildSide(label: string, first: boolean, rows: number[][], snaps: BattleUnitSnapshot[]): HTMLElement {
    const box = el("div", "battle-side");
    const labelEl = el("div", "battle-side-label");
    labelEl.appendChild(el("span", undefined, label));
    labelEl.appendChild(el("span", "first-badge", first ? "先手" : "后手"));
    box.appendChild(labelEl);
    const grid = el("div", "battle-grid");
    for (const row of rows) {
      for (const pos of row) {
        const cell = el("div", "battle-cell");
        const snap = snaps.find((s) => s.position === pos);
        if (snap) cell.appendChild(makeUnit(snap));
        grid.appendChild(cell);
      }
    }
    box.appendChild(grid);
    return box;
  }

  // 敌方在上（镜像：后排 4-6 上一行，前排 1-3 下一行，面对我方）
  root.appendChild(
    buildSide(
      `对手 玩家${start.a === 0 ? start.b : start.a}`,
      start.a !== 0,
      [[4, 5, 6], [1, 2, 3]],
      boards[enemySide],
    ),
  );

  const center = el("div", "battle-center");
  const action = el("div", "battle-action", "战斗开始！");
  center.appendChild(action);
  const resultEl = el("div", "battle-result");
  center.appendChild(resultEl);
  root.appendChild(center);

  // 我方在下（前排 1-3 上一行，后排 4-6 下一行）
  root.appendChild(buildSide("你", start.a === 0, [[1, 2, 3], [4, 5, 6]], boards[meSide]));

  const controls = el("div", "battle-controls");
  let speed = 380;
  let instant = false;
  const btnSpeed = el("button", "btn", "⏩ 加速");
  btnSpeed.addEventListener("click", () => {
    speed = speed === 380 ? 60 : 380;
    btnSpeed.textContent = speed === 380 ? "⏩ 加速" : "▶ 原速";
  });
  controls.appendChild(btnSpeed);
  const btnSkip = el("button", "btn", "⏭ 跳过");
  btnSkip.addEventListener("click", () => {
    instant = true;
    btnSkip.disabled = true;
  });
  controls.appendChild(btnSkip);
  const btnDone = el("button", "btn overlay-close", "继续 ▶");
  btnDone.classList.add("hidden");
  btnDone.addEventListener("click", () => {
    overlay.classList.add("hidden");
    onDone();
  });
  controls.appendChild(btnDone);
  root.appendChild(controls);
  overlay.appendChild(root);

  // ── 逐事件回放 ──
  const rest = events.slice(1);
  let finished = false;

  function applyEvent(e: BattleEvent): void {
    switch (e.type) {
      case "ATTACK": {
        const from = units.get(e.from);
        const to = units.get(e.to);
        action.textContent = `${from?.name ?? `#${e.from}`} 攻击 ${to?.name ?? `#${e.to}`}，造成 ${e.dmg} 伤害`;
        from?.root.classList.remove("attacking");
        void from?.root.offsetWidth; // 重启动画
        from?.root.classList.add("attacking");
        if (to) {
          to.hp = Math.max(0, to.hp - e.dmg);
          to.hpFill.style.width = `${(to.hp / to.maxHp) * 100}%`;
          to.hpText.textContent = `${to.hp}/${to.maxHp}`;
          const dmg = el("div", "dmg-float", `-${e.dmg}`);
          to.root.appendChild(dmg);
          window.setTimeout(() => dmg.remove(), 700);
          if (to.hp <= 0) to.root.classList.add("unit-dead");
        }
        break;
      }
      case "DEATH": {
        const u = units.get(e.who);
        u?.root.classList.add("unit-dead");
        action.textContent = `${u?.name ?? `#${e.who}`} 阵亡`;
        break;
      }
      case "BATTLE_END": {
        if (e.winner === 0) {
          resultEl.textContent = "🏆 你赢了！";
        } else if (e.winner === null) {
          resultEl.textContent = "⚖ 平局";
        } else {
          resultEl.textContent = `💀 你输了（玩家${e.winner} 获胜）`;
        }
        finished = true;
        break;
      }
      case "BATTLE_START":
      case "COMBINE":
        break;
    }
  }

  void (async () => {
    for (const e of rest) {
      if (finished) break;
      applyEvent(e);
      await sleep(instant ? 0 : speed);
    }
    finished = true;
    btnDone.classList.remove("hidden");
  })();
}

/* ══════════════ 终局 / 通用 ══════════════ */

export function showFinalOverlay(ranking: PlayerState[], onRestart: () => void): void {
  const overlay = getOverlay();
  overlay.replaceChildren();
  overlay.classList.remove("hidden");
  const panel = el("div", "overlay-panel");
  panel.appendChild(el("div", "overlay-title", "🏆 对局结束"));
  const list = el("div", "final-list");
  for (const p of ranking) {
    const row = el("div", p.id === 0 ? "final-row final-me" : "final-row");
    row.appendChild(el("span", "final-rank", `第${p.rank}名`));
    row.appendChild(el("span", undefined, p.id === 0 ? "你" : `玩家${p.id}`));
    row.appendChild(el("span", undefined, `剩余血量 ${p.hp}`));
    list.appendChild(row);
  }
  panel.appendChild(list);
  const btn = el("button", "btn overlay-close", "再来一局 ↻");
  btn.addEventListener("click", onRestart);
  panel.appendChild(btn);
  overlay.appendChild(panel);
}

function getOverlay(): HTMLElement {
  return document.getElementById("overlay")!;
}

export function hideOverlay(): void {
  getOverlay().classList.add("hidden");
}

export function showToast(msg: string): void {
  const toast = document.getElementById("toast")!;
  toast.textContent = msg;
  toast.classList.remove("hidden");
  window.clearTimeout((toast as unknown as { _t?: number })._t);
  (toast as unknown as { _t?: number })._t = window.setTimeout(
    () => toast.classList.add("hidden"),
    2200,
  );
}

export function cardNameOf(uid: number, state: GameState): string {
  for (const p of state.players) {
    const c = [...p.hand, ...p.board].find((x) => x !== null && x.uid === uid);
    if (c) return cardName(c);
  }
  return `#${uid}`;
}
