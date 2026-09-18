/**
 * Web 渲染层（DOM 构建；零游戏逻辑）
 *
 * 流程：开始界面 → 匹配选图（5s 投票）→ 对局界面（顶栏 / 商店 / 棋盘 / 仓库 + 右列对手与羁绊）
 * 弹窗：卡牌详情（含二星预览）/ 商店概率 / 羁绊详情 / 对手上回合阵容 / 战斗回放
 * 战斗层只消费事件日志，绝不反向修改核心状态。
 */
import type {
  BattleEvent,
  BattleUnitSnapshot,
  CardInstance,
  EquipInstance,
  GameState,
  PlayerState,
  StatusId,
} from "../core/state";
import { totalAtk, totalHp, EQUIP_SLOTS, equipAtk, equipHp } from "../core/state";
import { CARD_BY_ID, CARD_POOL, HERO_CARDS, type CardConfig } from "../config/cards";
import { expToUpgrade, goldToUpgrade } from "../config/economy";
import { shopConfig } from "../config/shop";
import { damageConfig } from "../config/damage";
import { TRAIT_BY_ID, TRAIT_LIST, tierIndexFor, traitName } from "../config/traits";
import { GAME_MAPS, MAP_BY_ID, type MapId } from "../config/maps";
import { traitCountsOfConfigIds } from "../core/traits";
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

const QUALITY_ORDER: Record<string, number> = { green: 0, blue: 1, purple: 2, orange: 3, gold: 4 };

const STATUS_LABEL: Record<StatusId, string> = { stun: "眩晕", charm: "魅惑", damage_reduction: "减伤" };
const STATUS_CLASS: Record<StatusId, string> = { stun: "st-stun", charm: "st-charm", damage_reduction: "st-dr" };

/** DOM 宿主：正常浏览器里是 body，测试的最小 DOM 里退化为遮罩层 */
function floatHost(): HTMLElement {
  return (document.body as HTMLElement | undefined) ?? getOverlay();
}

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

/* ══════════ 战斗中点单位看状态 ══════════ */


/**
 * 战斗中点任意单位（含对手）弹出状态面板：
 * 当前/最大生命、攻击、法力、护盾、状态、装备、技能。
 * 战斗还在播放也能点，面板是独立的 fixed 层，不打断播放。
 */
export function showBattleUnitDetail(snap: BattleUnitSnapshot, isMine: boolean): void {
  const config = CARD_BY_ID.get(snap.configId);
  const host = hostDetail();
  if (!config || !host) return;

  const panel = el("div", "panel bu-detail");
  const head = el("div", "detail-head");
  const art = el("div", "detail-art");
  art.appendChild(artEl(config));
  head.appendChild(art);

  const meta = el("div", "detail-meta");
  meta.appendChild(el("div", "detail-name", `${config.name}${snap.level === 2 ? " ★★" : ""}`));
  meta.appendChild(
    el("div", "detail-sub", `${isMine ? "我方" : "对手"} · ${snap.position}${snap.position <= 3 ? "前" : "后"}位`),
  );
  const stats = el("div", "detail-stats");
  const addStat = (cls: string, label: string, value: string) => {
    const chip = el("span", `detail-chip ${cls}`);
    chip.appendChild(el("i", undefined, label));
    chip.appendChild(el("b", undefined, value));
    stats.appendChild(chip);
  };
  addStat("atk", "攻击", String(snap.atk));
  addStat("hp", "生命", `${snap.hp}/${snap.maxHp}`);
  if (snap.shield > 0) addStat("shield", "护盾", String(snap.shield));
  if (config.maxMana > 0) addStat("mana", "法力", `${snap.mana}/${snap.maxMana}`);
  meta.appendChild(stats);
  head.appendChild(meta);
  panel.appendChild(head);
  panel.appendChild(el("div", "panel-sep"));

  // 状态
  const statusBlock = el("div", "detail-block");
  statusBlock.appendChild(el("h4", undefined, "当前状态"));
  if (snap.statuses.length === 0) {
    statusBlock.appendChild(el("div", "detail-sub", "无异常状态"));
  } else {
    const row = el("div", "bu-status-list");
    for (const st of snap.statuses) {
      const left = Math.max(0, st.duration ?? 0);
      row.appendChild(
        el("span", "status-chip", `${STATUS_LABEL[st.id] ?? st.id}${left > 0 ? ` · 剩 ${left} 次行动` : ""}`),
      );
    }
    statusBlock.appendChild(row);
  }
  statusBlock.appendChild(
    el("div", "detail-sub", `已普攻 ${snap.attackCount} 次 · 已施法 ${snap.castCount} 次`),
  );
  panel.appendChild(statusBlock);

  // 装备（战斗中：只显示已装备的，不显示空格）
  if (snap.equips && snap.equips.length > 0) {
    const block = el("div", "detail-block");
    block.appendChild(el("h4", undefined, "武器槽"));
    const slots = el("div", "equip-slots");
    for (const eq of snap.equips) {
      const wcfg = CARD_BY_ID.get(eq.configId);
      const slot = el("div", "equip-slot filled");
      if (wcfg) slot.appendChild(artEl(wcfg, "equip-slot-img"));
      slot.appendChild(el("span", "equip-slot-stat", `+${eq.atk}/+${eq.hp}`));
      if (eq.level === 2) slot.appendChild(el("span", "equip-slot-star", "★"));
      slots.appendChild(slot);
    }
    block.appendChild(slots);
    panel.appendChild(block);
  }

  if (config.skill) {
    const block = el("div", "detail-block");
    block.appendChild(el("h4", undefined, `主动技能 · ${config.skill.name}`));
    block.appendChild(el("div", undefined, config.skill.desc));
    panel.appendChild(block);
  }

  const foot = el("div", "panel-foot");
  const close = el("button", "btn btn-gold", "知道了");
  close.addEventListener("click", () => hideDetail());
  foot.appendChild(close);
  panel.appendChild(foot);
  host.replaceChildren(panel);
  host.classList.remove("hidden");
}

/* ══════════ 出售区（拖动时盖在商店面板上） ══════════ */

/**
 * 拖动自己已有的卡/武器时，在商店面板上盖一层半透明「出售区」并显示回收价
 * （参考截图）。必须 `pointer-events: none`，否则会挡住 elementFromPoint 的落点判定。
 */
export function showSellZone(price: number): void {
  const panel = document.getElementById("shoppanel");
  if (!panel) return;
  hideSellZone();
  const zone = el("div", "sell-zone");
  zone.id = "sellzone";
  const title = el("div", "sell-zone-title", "出售区");
  const row = el("div", "sell-zone-price");
  row.appendChild(el("span", "coin"));
  row.appendChild(el("span", undefined, String(price)));
  zone.append(title, row);
  panel.appendChild(zone);
}

export function hideSellZone(): void {
  document.getElementById("sellzone")?.remove();
}

export function setSellZoneActive(on: boolean): void {
  document.getElementById("sellzone")?.classList.toggle("active", on);
}

function cardName(c: CardInstance | { uid: number; configId: string }): string {
  return CARD_BY_ID.get(c.configId)?.name ?? c.configId;
}

/* ══════════════ 立绘 ══════════════ */

/**
 * 静态资源 URL。
 * config 里存的是规范化绝对路径（"/assets/lol/..."，`config/validate.ts` 会按字面量校验），
 * 但部署到**子路径**（GitHub Pages 的 /<repo>/）时必须补上 Vite 的 BASE_URL，
 * 否则所有立绘/头像/武器图标都会 404。base 为 "./" 时得到 "./assets/..."，任意路径都能用。
 */
function assetUrl(path: string): string {
  const base = import.meta.env.BASE_URL || "/";
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/** 卡面立绘：立绘 → 方形头像 → 首字占位，三级回退，缺图不破图 */
function artEl(config: CardConfig, cls = "card-art"): HTMLElement {
  const sources = [config.portrait, config.image]
    .filter((s): s is string => Boolean(s))
    .map(assetUrl);
  if (sources.length === 0) return el("div", "card-art-fallback", config.name.slice(0, 1));

  const img = document.createElement("img");
  img.className = cls;
  img.alt = config.name;
  img.decoding = "async";
  let idx = 0;
  img.src = sources[0]!;
  img.addEventListener("error", () => {
    idx += 1;
    if (idx < sources.length) {
      img.src = sources[idx]!;
      return;
    }
    img.replaceWith(el("div", "card-art-fallback", config.name.slice(0, 1)));
  });
  return img;
}

function traitTags(config: CardConfig): HTMLElement {
  const row = el("div", "detail-tags");
  if (config.region) row.appendChild(el("span", "tag tag-region", traitName(config.region)));
  for (const prof of config.professions) row.appendChild(el("span", `tag tag-prof prof-${prof}`, traitName(prof)));
  if (row.childElementCount === 0) row.appendChild(el("span", "tag tag-none", "功能牌"));
  return row;
}

/* ══════════════ 卡面 ══════════════ */

interface CardFaceOpts {
  config: CardConfig;
  level: 1 | 2;
  atk: number;
  hp: number;
  extraClass?: string;
  disabled?: boolean;
  /** 商店卡：立绘下方追加 技能说明 + 名称 + 价格 */
  shop?: boolean;
  /** 已装备的武器（最多 EQUIP_SLOTS 件，显示在卡面底部武器槽里） */
  equips?: EquipInstance[];
  /** 卡牌实例 uid（拖拽命中用） */
  uid?: number;
  /** 成长累计值（>0 时卡面右上角显示 +N） */
  growthAtk?: number;
  growthHp?: number;
}

/**
 * 卡面：
 *   .card > .card-frame（立绘 + 品质角标 + 角上攻血）
 *   商店卡额外有 .card-ability / .card-shopname / .card-cost
 *   棋盘/仓库卡额外有 .card-skill（一句话技能）+ .card-namebar + .card-weapon（武器槽）
 */
export function cardFace(opts: CardFaceOpts): HTMLElement {
  const { config, level, atk, hp } = opts;
  const isWeapon = config.type === "weapon";
  const card = el("div", `card ${QUALITY_CLASS[config.quality]} ${level === 2 ? "lv2" : ""} ${opts.extraClass ?? ""}`);
  if (opts.uid !== undefined) card.dataset.uid = String(opts.uid);

  const frame = el("div", isWeapon ? "card-frame weapon-frame" : "card-frame");
  frame.appendChild(artEl(config));
  frame.appendChild(el("div", "card-shade"));
  frame.appendChild(el("div", "card-badge", QUALITY_LABEL[config.quality] ?? "?"));

  if (!opts.shop) {
    // 对齐参考图：棋盘/仓库卡**只有立绘 + 角上数值 + 底部武器槽**，不写字
    // （技能、名字、地区/职业都在点击后的详情里，避免文字压住立绘）
    if (config.maxMana > 0) {
      const bar = el("div", "card-manabar");
      const fill = el("div", "card-manafill");
      fill.style.width = `${config.maxMana > 0 ? Math.min(100, (config.startMana / config.maxMana) * 100) : 0}%`;
      bar.appendChild(fill);
      frame.appendChild(bar);
    }
    // 成长角标：上阵攒出来的攻/血，卡面右上角一个小绿标
    const gAtk = opts.growthAtk ?? 0;
    const gHp = opts.growthHp ?? 0;
    if (gAtk + gHp > 0) {
      const parts = [gAtk > 0 ? `+${gAtk}攻` : "", gHp > 0 ? `+${gHp}血` : ""].filter(Boolean);
      frame.appendChild(el("div", "card-growth", parts.join(" ")));
    }
    // 武器槽：2 格，有装备就显示武器图标
    const slot = el("div", "card-weapon");
    const equips = opts.equips ?? [];
    for (const equip of equips.slice(0, EQUIP_SLOTS)) {
      const wcfg = CARD_BY_ID.get(equip.configId);
      if (wcfg) slot.appendChild(artEl(wcfg, "cw-icon"));
    }
    if (equips.length > 0) {
      slot.classList.add("has-weapon");
      slot.dataset.count = String(Math.min(equips.length, EQUIP_SLOTS));
      slot.title = equips
        .map((e) => {
          const w = CARD_BY_ID.get(e.configId);
          return `${w?.name ?? e.configId}${e.level === 2 ? " ★★" : ""}（+${e.atk}攻 +${e.hp}血）`;
        })
        .join("　");
    }
    frame.appendChild(slot);
  } else if (level === 2) {
    frame.appendChild(el("span", "card-stars", "★★"));
  }

  frame.appendChild(el("div", "card-atk", String(atk)));
  frame.appendChild(el("div", "card-hp", String(hp)));
  card.appendChild(frame);

  if (opts.shop) {
    // 参考图：商店卡是竖版——立绘在上，下面竖排「一句话说明 + 名称 + 价格」
    const text = el("div", "card-text");
    const brief = config.skill?.brief ?? config.skill?.desc ?? config.weaponDesc ?? "万能合成牌，不参与羁绊、不能上阵";
    text.appendChild(el("div", "card-ability", brief));
    text.appendChild(el("div", "card-shopname", config.name));
    const cost = el("div", "card-cost");
    cost.appendChild(el("span", "coin"));
    cost.appendChild(el("span", undefined, String(config.price)));
    text.appendChild(cost);
    card.appendChild(text);
  }

  if (opts.disabled) card.classList.add("disabled");
  return card;
}

/* ══════════════ 开始界面 ══════════════ */

export interface StartInfo {
  /** 历史最好名次（localStorage，可能为 null） */
  bestRank: number | null;
  /** 已玩局数 */
  played: number;
}

export function showStartScreen(
  info: StartInfo,
  handlers: { onMatch: () => void; onCodex?: () => void; onHelp?: () => void },
): void {
  const host = document.getElementById("start");
  if (!host) return;
  host.replaceChildren();
  host.classList.remove("hidden");

  const inner = el("div", "start-inner");

  inner.appendChild(el("div", "start-crest", "⚔"));
  inner.appendChild(el("div", "start-title", "英雄战棋"));
  inner.appendChild(el("div", "start-sub", "8 人自动战斗 · LoL 英雄主题 · 本地原型"));

  // 立绘展示墙（用本地缓存的官方立绘做装饰）
  const showcase = el("div", "start-showcase");
  for (const id of ["garen", "ahri", "jinx", "yasuo", "lux", "darius", "kalista", "thresh"]) {
    const config = CARD_BY_ID.get(id);
    if (!config) continue;
    const face = el("div", "showcase-face");
    face.appendChild(artEl(config, "showcase-img"));
    showcase.appendChild(face);
  }
  inner.appendChild(showcase);

  const card = el("div", "start-card");
  const row = el("div", "start-row");
  row.appendChild(el("span", undefined, "个人战绩"));
  row.appendChild(el("b", undefined, info.bestRank ? `最好名次 第 ${info.bestRank} 名` : "暂无记录"));
  card.appendChild(row);
  const bar = el("div", "start-bar");
  const fill = el("div");
  fill.style.width = `${info.bestRank ? Math.max(8, (9 - info.bestRank) * 11) : 4}%`;
  bar.appendChild(fill);
  card.appendChild(bar);
  const row2 = el("div", "start-row");
  row2.appendChild(el("span", undefined, "已完成对局"));
  row2.appendChild(el("b", undefined, `${info.played} 局`));
  card.appendChild(row2);
  card.appendChild(
    el(
      "div",
      "start-version",
      `规则版本 ${"0.7"} · 20 名英雄 · 5 地区 6 职业 · 三张地图`,
    ),
  );
  inner.appendChild(card);

  const actions = el("div", "start-actions");
  const btnMatch = el("button", "btn btn-gold", "⚔ 开始匹配");
  btnMatch.addEventListener("click", () => {
    host.classList.add("hidden");
    handlers.onMatch();
  });
  actions.appendChild(btnMatch);

  const mini = el("div", "start-mini");
  const btnCodex = el("button", "btn", "图鉴");
  btnCodex.addEventListener("click", () => handlers.onCodex?.());
  mini.appendChild(btnCodex);
  const btnHelp = el("button", "btn", "玩法");
  btnHelp.addEventListener("click", () => handlers.onHelp?.());
  mini.appendChild(btnHelp);
  const btnAssets = el("button", "btn", "美术");
  btnAssets.addEventListener("click", () =>
    showToast("英雄立绘来自 Riot Data Dragon，本地缓存，非官方素材"),
  );
  mini.appendChild(btnAssets);
  const btnSeed = el("button", "btn", "重置");
  btnSeed.addEventListener("click", () => {
    try {
      localStorage.removeItem("lolcodex.record");
    } catch {
      /* 忽略隐私模式 */
    }
    showToast("已清除本地战绩记录");
  });
  mini.appendChild(btnSeed);
  actions.appendChild(mini);
  inner.appendChild(actions);

  host.appendChild(inner);
}

export function hideStartScreen(): void {
  document.getElementById("start")?.classList.add("hidden");
}

/* ══════════════ 匹配 / 选图 ══════════════ */

export interface MatchHandlers {
  /** 玩家投票（点地图卡）；选图阶段结束由外部决定 */
  onVote: (id: MapId) => void;
  /** 倒计时结束 */
  onFinish: (picked: MapId | null) => void;
}

export interface MatchState {
  secondsLeft: number;
  picked: MapId | null;
  tally: Record<string, number>;
  /** 已揭晓的各玩家投票（下标 = 玩家 id，null = 还没揭晓） */
  revealedVotes: (MapId | null)[];
  /** 已揭晓的胜出地图（倒计时结束后才有） */
  winner: MapId | null;
}

let matchTimer: number | undefined;

export interface MatchScreen {
  /** 刷新票数与胜出结果 */
  update(state: MatchState): void;
  close(): void;
}

/** 开始匹配界面：3 张地图 + 倒计时（到点回调 onFinish） */
export function showMatchScreen(seconds: number, handlers: MatchHandlers): MatchScreen {
  const host = document.getElementById("match")!;
  host.replaceChildren();
  host.classList.remove("hidden");

  const inner = el("div", "match-inner");
  const head = el("div", "match-head");
  const title = el("div", "match-title", "交战选图");
  const timer = el("div", "match-timer", `${seconds}s`);
  head.appendChild(title);
  head.appendChild(timer);
  inner.appendChild(head);
  inner.appendChild(el("div", "match-tip", "投票选择本局地图，票数最多者生效（7 名 AI 也会投票）"));

  const list = el("div", "map-list");
  inner.appendChild(list);

  // 本局阵容：8 名玩家的投票会逐个揭晓
  const roster = el("div", "match-roster");
  inner.appendChild(roster);

  const ready = el("div", "match-ready", "倒计时结束前点选一张地图");
  inner.appendChild(ready);
  host.appendChild(inner);

  const rosterCells: HTMLElement[] = [];
  for (let i = 0; i < 8; i++) {
    const cell = el("div", "roster-cell");
    cell.appendChild(el("div", "roster-face", i === 0 ? "你" : `P${i}`));
    cell.appendChild(el("div", "roster-vote", "…"));
    roster.appendChild(cell);
    rosterCells.push(cell);
  }

  let picked: MapId | null = null;
  const voteEls = new Map<MapId, HTMLElement>();
  const countEls = new Map<MapId, HTMLElement>();
  const barEls = new Map<MapId, HTMLElement>();

  for (const map of GAME_MAPS) {
    const card = el("div", "map-card");
    const art = el("div", "map-art", map.icon);
    art.style.background = `linear-gradient(160deg, ${map.colors[0]}, ${map.colors[1]})`;
    card.appendChild(art);
    const votes = el("div", "map-votes", "0");
    card.appendChild(votes);
    const body = el("div", "map-body");
    body.appendChild(el("div", "map-name", map.name));
    body.appendChild(el("div", "map-desc", map.desc));
    body.appendChild(el("div", "map-flavor", map.flavor));
    const bar = el("div", "map-bar");
    const barFill = el("div");
    barFill.style.width = "0%";
    bar.appendChild(barFill);
    body.appendChild(bar);
    card.appendChild(body);
    card.addEventListener("click", () => {
      picked = map.id;
      handlers.onVote(map.id);
      for (const [id, node] of voteEls) node.classList.toggle("picked", id === map.id);
      ready.textContent = `已投票：${map.name}（票数最多者生效）`;
    });
    list.appendChild(card);
    voteEls.set(map.id, card);
    countEls.set(map.id, votes);
    barEls.set(map.id, barFill);
  }

  let left = seconds;
  window.clearInterval(matchTimer);
  matchTimer = window.setInterval(() => {
    left -= 1;
    timer.textContent = `${Math.max(0, left)}s`;
    if (left <= 0) {
      window.clearInterval(matchTimer);
      handlers.onFinish(picked);
    }
  }, 1000);

  return {
    update(state: MatchState) {
      const total = Math.max(1, Object.values(state.tally).reduce((a, b) => a + b, 0));
      for (const m of GAME_MAPS) {
        countEls.get(m.id)!.textContent = String(state.tally[m.id] ?? 0);
        barEls.get(m.id)!.style.width = `${((state.tally[m.id] ?? 0) / total) * 100}%`;
        voteEls.get(m.id)!.classList.toggle("winner", state.winner === m.id);
      }
      state.revealedVotes.forEach((vote, i) => {
        const cell = rosterCells[i];
        if (!cell) return;
        const map = vote ? MAP_BY_ID.get(vote) : null;
        cell.classList.toggle("voted", Boolean(vote));
        cell.classList.toggle("me", i === 0);
        const voteEl = cell.children[1] as HTMLElement | undefined;
        if (voteEl) voteEl.textContent = map ? `${map.icon}` : "…";
        cell.title = map ? `玩家${i} 投给 ${map.name}` : `玩家${i} 尚未投票`;
      });
      if (state.winner) {
        const map = MAP_BY_ID.get(state.winner);
        ready.replaceChildren(
          document.createTextNode("本局地图："),
          el("b", undefined, map?.name ?? state.winner),
          document.createTextNode(` · ${map?.desc ?? ""}`),
        );
      }
      if (state.secondsLeft > 0) timer.textContent = `${state.secondsLeft}s`;
    },
    close() {
      window.clearInterval(matchTimer);
      host.classList.add("hidden");
    },
  };
}

/* ══════════════ 顶栏 ══════════════ */

export function renderTopbar(
  state: GameState,
  handlers: { onOdds?: () => void; onMap?: () => void; onSettings?: () => void; onCodex?: () => void } = {},
): void {
  const bar = document.getElementById("tb-left") ?? document.getElementById("topbar")!;
  bar.replaceChildren();
  const p = state.players[0]!;
  const cost = expToUpgrade(p.shopLevel);
  const gap = cost === null ? null : Math.max(0, cost - p.exp);

  const row = el("div", "toprow");

  const gear = el("span", "tb-btn", "⚙");
  gear.title = "设置（可退出到主菜单）";
  if (handlers.onSettings) gear.addEventListener("click", handlers.onSettings);
  row.appendChild(gear);

  const codex = el("span", "tb-btn", "▤");
  codex.title = "图鉴：查看全部英雄与武器";
  if (handlers.onCodex) codex.addEventListener("click", handlers.onCodex);
  row.appendChild(codex);

  const banner = el("span", "lv-banner");
  banner.appendChild(el("span", "lv-ico", "⚔"));
  banner.appendChild(el("span", undefined, `Lv${p.shopLevel}`));
  banner.title = gap === null ? "已到最高级" : `距离升级还差 ${gap} 经验（补 ${gap} 金币）`;
  if (handlers.onOdds) banner.addEventListener("click", handlers.onOdds);
  row.appendChild(banner);

  if (state.mapId) {
    const map = MAP_BY_ID.get(state.mapId);
    const chip = el("span", "map-chip", `${map?.icon ?? ""}${map?.name ?? state.mapId}`);
    chip.title = `本局地图：${map?.name ?? ""} · ${map?.desc ?? ""}`;
    if (handlers.onMap) chip.addEventListener("click", handlers.onMap);
    row.appendChild(chip);
  }

  const expBar = el("div", "exp-bar");
  const expFill = el("div", "exp-fill");
  if (cost === null) {
    expFill.style.width = "100%";
    expFill.classList.add("max");
  } else {
    expFill.style.width = `${Math.max(0, Math.min(100, (p.exp / cost) * 100))}%`;
  }
  expBar.appendChild(expFill);
  row.appendChild(expBar);

  const gold = el("span", "tb-gold");
  gold.appendChild(el("span", "coin"));
  gold.appendChild(el("span", undefined, p.freeRefresh > 0 ? `${p.gold}+${p.freeRefresh}` : String(p.gold)));
  gold.title = `金币 ${p.gold}${p.freeRefresh > 0 ? `，免费刷新 ${p.freeRefresh} 次` : ""}`;
  row.appendChild(gold);

  bar.appendChild(row);
}

/* ══════════════ 右列：对手 ══════════════ */

export function renderOppStrip(
  state: GameState,
  vsId: number | null = null,
  onOpponentTap?: (id: number) => void,
): void {
  const box = document.getElementById("opps")!;
  box.replaceChildren();
  for (const p of state.players) {
    const tile = el(
      "div",
      `opp ${p.eliminated ? "opp-dead" : ""} ${p.id === 0 ? "opp-me" : ""} ${p.id === vsId ? "opp-vs" : ""}`,
    );
    tile.title = p.id === 0 ? "你（点击查看自己阵容）" : `玩家${p.id} · 点击查看上回合阵容`;
    tile.appendChild(el("div", "opp-face", p.id === 0 ? "你" : `P${p.id}`));
    const info = el("div", "opp-info");
    info.appendChild(el("div", "opp-hptext", String(p.hp)));
    const hp = el("div", "opp-hp");
    const fill = el("div", "opp-hpfill");
    fill.style.width = `${Math.max(0, Math.min(100, (p.hp / damageConfig.initialHp) * 100))}%`;
    hp.appendChild(fill);
    info.appendChild(hp);
    tile.appendChild(info);
    if (p.rank !== null) tile.appendChild(el("div", "opp-rank", `${p.rank}`));
    if (onOpponentTap) tile.addEventListener("click", () => onOpponentTap(p.id));
    box.appendChild(tile);
  }
}

/* ══════════════ 右列：羁绊 ══════════════ */

export interface TraitRow {
  id: string;
  name: string;
  count: number;
  tier: number;
  next: number | null;
}

export function traitRowsOf(player: PlayerState): TraitRow[] {
  const ids = player.board.filter((c): c is CardInstance => c !== null).map((c) => c.configId);
  const counts = traitCountsOfConfigIds(ids);
  const rows: TraitRow[] = [];
  for (const trait of TRAIT_LIST) {
    const count = counts.get(trait.id) ?? 0;
    if (count === 0) continue;
    const tier = tierIndexFor(trait.id, count);
    const next = tier >= 1 ? null : tier === 0 ? trait.thresholds[1] : trait.thresholds[0];
    rows.push({ id: trait.id, name: trait.name, count, tier, next });
  }
  const order = new Map(TRAIT_LIST.map((t, i) => [t.id as string, i]));
  return rows.sort((a, b) => b.tier - a.tier || b.count - a.count || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

export function renderTraits(state: GameState, onTraitTap?: (id: string) => void): void {
  const box = document.getElementById("traits");
  if (!box) return;
  box.replaceChildren();
  const rows = traitRowsOf(state.players[0]!);
  const panel = el("div", "traits-panel");
  panel.appendChild(el("div", "traits-title", "羁绊"));
  if (rows.length === 0) panel.appendChild(el("div", "traits-empty", "上阵激活羁绊"));
  for (const row of rows) {
    const chip = el("div", `trait-chip tier-${row.tier}`);
    chip.appendChild(el("span", "trait-hex", String(row.count)));
    chip.appendChild(el("span", "trait-name", row.name));
    chip.appendChild(el("span", "trait-count", row.next === null ? "满" : `${row.count}/${row.next}`));
    chip.appendChild(el("span", "trait-tier", row.tier === 1 ? "4档" : "2档"));
    chip.title = `${row.name}：${TRAIT_BY_ID.get(row.id as never)?.desc[row.tier >= 0 ? row.tier : 0] ?? ""}（点击查看）`;
    if (onTraitTap) chip.addEventListener("click", () => onTraitTap(row.id));
    panel.appendChild(chip);
  }
  box.appendChild(panel);
}

/* ══════════════ 棋盘 / 仓库 ══════════════ */

export function renderBoard(
  state: GameState,
  onCardDown: (uid: number, e: PointerEvent) => void,
  onCardTap?: (uid: number, e: PointerEvent) => void,
): void {
  const box = document.getElementById("board")!;
  box.replaceChildren();
  // 竖屏：3 列 × 2 行，第一行前排（1/2/3）、第二行后排（4/5/6）
  for (const pos of [1, 2, 3, 4, 5, 6]) {
    const slot = el("div", "board-slot");
    slot.dataset.pos = String(pos);
    slot.appendChild(el("div", "slot-pos", `${pos}${pos <= 3 ? "前" : "后"}`));
    const c = state.players[0]!.board[pos - 1];
    if (c) {
      const card = renderCard(c, "board-card");
      card.addEventListener("pointerdown", (e) => onCardDown(c.uid, e));
      if (onCardTap) card.addEventListener("click", (e) => onCardTap(c.uid, e as unknown as PointerEvent));
      slot.appendChild(card);
    } else {
      slot.appendChild(el("div", "slot-empty", "空"));
    }
    box.appendChild(slot);
  }
}

/**
 * 仓库：**英雄和武器共用一条卡槽**（对齐 CFM：下面一条横滑槽放所有卡）
 * - 英雄卡可拖到棋盘 / 商店
 * - 武器卡可拖到英雄身上装备 / 拖到商店出售
 */
export function renderHand(
  state: GameState,
  onCardDown: (uid: number, e: PointerEvent) => void,
  onCardTap?: (uid: number, e: PointerEvent) => void,
  onWeaponDown?: (uid: number, e: PointerEvent) => void,
  onWeaponTap?: (uid: number, e: PointerEvent) => void,
): void {
  const box = document.getElementById("hand")!;
  box.replaceChildren();
  const p = state.players[0]!;
  if (p.hand.length === 0 && p.weapons.length === 0) {
    box.appendChild(
      el("div", "empty-hint", `仓库 ${p.hand.length}/${shopConfig.handLimit} · 拖动商店卡到这里或棋盘`),
    );
    return;
  }

  // 武器排在最前面：刚买到的武器一眼就能看到，直接拖到英雄身上装备
  for (const w of p.weapons) {
    const config = CARD_BY_ID.get(w.configId);
    if (!config) continue;
    const chip = el("div", `bench-weapon ${QUALITY_CLASS[config.quality]}`);
    chip.dataset.uid = String(w.uid);
    const art = el("div", "bw-art");
    art.appendChild(artEl(config, "bw-img"));
    chip.appendChild(art);
    if (w.level === 2) chip.appendChild(el("span", "bw-star", "★★"));
    chip.appendChild(el("span", "bw-atk", `+${w.atk}`));
    chip.appendChild(el("span", "bw-hp", `+${w.hp}`));
    chip.title = `${config.name}${w.level === 2 ? " ★★" : ""}（+${w.atk}攻 +${w.hp}血）· 拖到英雄身上装备，拖到商店出售`;
    if (onWeaponDown) chip.addEventListener("pointerdown", (e) => onWeaponDown(w.uid, e));
    if (onWeaponTap) chip.addEventListener("click", (e) => onWeaponTap(w.uid, e as unknown as PointerEvent));
    box.appendChild(chip);
  }

  for (const c of p.hand) {
    const card = renderCard(c, "hand-card");
    card.addEventListener("pointerdown", (e) => onCardDown(c.uid, e));
    if (onCardTap) card.addEventListener("click", (e) => onCardTap(c.uid, e as unknown as PointerEvent));
    box.appendChild(card);
  }
}

export function renderCard(c: CardInstance, extraClass = ""): HTMLElement {
  const config = CARD_BY_ID.get(c.configId)!;
  return cardFace({
    config,
    level: c.level,
    atk: totalAtk(c),
    hp: totalHp(c),
    equips: c.equips,
    uid: c.uid,
    growthAtk: c.growthAtk,
    growthHp: c.growthHp,
    extraClass,
  });
}

export function renderReadyButton(state: GameState, onReady: () => void, hint = ""): void {
  const btn = document.getElementById("ready") as HTMLButtonElement | null;
  if (!btn) return;
  const me = state.players[0]!;
  btn.disabled = state.phase !== "shop" || me.shopDone || me.eliminated;
  btn.onclick = onReady;
  btn.title = me.eliminated ? "你已被淘汰，本局结束" : hint;
  btn.replaceChildren(
    el("span", "ready-num", String(state.round)),
    el("span", "ready-label", me.eliminated ? "淘汰" : "准备"),
  );
}

/* ══════════════ 商店 ══════════════ */

export function renderShop(
  state: GameState,
  onCardDown: (idx: number, e: PointerEvent) => void,
  onCardTap?: (idx: number, e: PointerEvent) => void,
): void {
  const box = document.getElementById("shop")!;
  box.replaceChildren();
  const p = state.players[0]!;
  const row = el("div", "shop-row");
  p.shop.forEach((id, i) => {
    const slot = el("div", "shop-slot");
    if (id === null) {
      slot.appendChild(el("div", "shop-empty", "已售空"));
    } else {
      const config = CARD_BY_ID.get(id)!;
      // 武器占武器库，英雄占手牌——分别判断各自的容量
      const hasRoom =
        config.type === "weapon"
          ? p.weapons.length < shopConfig.weaponLimit
          : p.hand.length < shopConfig.handLimit;
      const affordable = p.gold >= config.price && hasRoom;
      const card = cardFace({ config, level: 1, atk: config.atk, hp: config.hp, shop: true, disabled: !affordable });
      card.addEventListener("pointerdown", (e) => onCardDown(i, e));
      if (onCardTap) card.addEventListener("click", (e) => onCardTap(i, e as unknown as PointerEvent));
      slot.appendChild(card);
    }
    row.appendChild(slot);
  });
  box.appendChild(row);
}

export function renderShopButtons(state: GameState, onRefresh: () => void, onUpgrade: () => void): void {
  const box = document.getElementById("shopbtns")!;
  box.replaceChildren();
  const p = state.players[0]!;
  const row = el("div", "btnrow");

  const gap = goldToUpgrade(p.shopLevel, p.exp);
  const btnUp = el("button", "btn btn-gold") as HTMLButtonElement;
  if (gap === null) {
    btnUp.textContent = "已满级";
    btnUp.disabled = true;
  } else {
    btnUp.textContent = `升级 🪙${gap}`;
    btnUp.disabled = p.gold < gap;
  }
  btnUp.title = "补差金币升级商店等级";
  btnUp.addEventListener("click", onUpgrade);
  row.appendChild(btnUp);

  const btnRefresh = el("button", "btn btn-gold") as HTMLButtonElement;
  btnRefresh.textContent = p.freeRefresh > 0 ? `刷新 🎁${p.freeRefresh}` : `刷新 🪙${shopConfig.refreshCost}`;
  btnRefresh.disabled = p.freeRefresh <= 0 && p.gold < shopConfig.refreshCost;
  btnRefresh.title = "刷新商店";
  btnRefresh.addEventListener("click", onRefresh);
  row.appendChild(btnRefresh);

  box.appendChild(row);
}

/* ══════════════ 通用弹窗 ══════════════ */

function openPanel(host: HTMLElement, panel: HTMLElement): void {
  host.replaceChildren();
  host.classList.remove("hidden");
  const close = el("button", "panel-close", "✕");
  close.addEventListener("click", hideDetail);
  panel.appendChild(close);
  host.appendChild(panel);
  host.addEventListener("click", (e) => {
    if (e.target === host) hideDetail();
  });
}

export function hideDetail(): void {
  const host = document.getElementById("detail");
  if (!host) return;
  host.classList.add("hidden");
  host.replaceChildren();
}

function hostDetail(): HTMLElement | null {
  return document.getElementById("detail");
}

/* ══════════════ 卡牌详情（含二星预览） ══════════════ */

export function showCardDetail(
  configId: string,
  opts: {
    level?: 1 | 2;
    atk?: number;
    hp?: number;
    player?: PlayerState;
    equips?: EquipInstance[];
    /** 卡牌实例 uid（有 uid 且已装备时才显示【卸下】） */
    uid?: number;
    /** 成长累计值：>0 时详情里显示「已成长」 */
    growthAtk?: number;
    growthHp?: number;
    onUnequip?: (weaponUid: number) => void;
  } = {},
): void {
  const config = CARD_BY_ID.get(configId);
  const host = hostDetail();
  if (!config || !host) return;
  const level = opts.level ?? 1;
  const equips = opts.equips ?? [];
  const atk = opts.atk ?? config.atk;
  const hp = opts.hp ?? config.hp;
  const isWeapon = config.type === "weapon";

  const panel = el("div", "panel");
  const head = el("div", "detail-head");
  const art = el("div", isWeapon ? "detail-art weapon" : "detail-art");
  art.appendChild(artEl(config));
  head.appendChild(art);

  const meta = el("div", "detail-meta");
  meta.appendChild(el("div", "detail-name", `${config.name}${level === 2 ? " ★★" : ""}`));
  meta.appendChild(
    el(
      "div",
      "detail-sub",
      isWeapon
        ? `${QUALITY_LABEL[config.quality]}装备 · ${config.price} 金币 · 装备到英雄身上生效`
        : `${QUALITY_LABEL[config.quality]}卡 · ${config.price} 金币 · ${config.type === "duplicator" ? "功能牌（不能上阵）" : "英雄"}`,
    ),
  );
  if (!isWeapon) meta.appendChild(traitTags(config));
  // 成长说明：让玩家一眼看出这张卡会越打越强（以及已经攒了多少）
  const g = config.growth;
  if (g) {
    const per = [g.atk ? `+${g.atk} 攻` : "", g.hp ? `+${g.hp} 血` : ""].filter(Boolean).join(" / ");
    const every = (g.every ?? 1) > 1 ? `每 ${g.every} 回合` : "每回合";
    const got = (opts.growthAtk ?? 0) + (opts.growthHp ?? 0);
    const parts = [`成长：上阵时${every} ${per}`];
    if ((opts.growthAtk ?? 0) > 0 || (opts.growthHp ?? 0) > 0) {
      parts.push(`已累计 +${opts.growthAtk ?? 0} 攻 +${opts.growthHp ?? 0} 血`);
    }
    meta.appendChild(el("div", got > 0 ? "detail-growth on" : "detail-growth", parts.join(" · ")));
  }

  const stats = el("div", "detail-stat-row");
  const addStat = (cls: string, label: string, value: string) => {
    const s = el("span", `detail-stat ${cls}`);
    s.appendChild(el("span", undefined, label));
    s.appendChild(el("b", undefined, value));
    stats.appendChild(s);
  };
  addStat("atk", level === 2 ? "攻击" : "一星攻", String(atk));
  addStat("hp", level === 2 ? "生命" : "一星血", String(hp));
  if (!isWeapon && config.maxMana > 0) addStat("mana", "法力", `${config.startMana}/${config.maxMana}`);
  meta.appendChild(stats);
  head.appendChild(meta);
  panel.appendChild(head);
  panel.appendChild(el("div", "panel-sep"));

  // 装备栏：武器卡讲装备规则，英雄讲自己带了什么
  if (isWeapon) {
    const block = el("div", "detail-block");
    block.appendChild(el("h4", undefined, "装备效果"));
    block.appendChild(
      el(
        "div",
        undefined,
        `装备到任意英雄身上后，该英雄获得 +${config.atk} 攻击、+${config.hp} 生命（二星武器数值为三张之和）。` +
          (config.wildcard === "weapon"
            ? "它是武器线的万能牌：可替代任意武器参与三合一（2 张同名 + 1 张它，或 1 张同名 + 2 张它）。"
            : ""),
      ),
    );
    if (config.weaponDesc) block.appendChild(el("div", "detail-sub", config.weaponDesc));
    panel.appendChild(block);
  } else if (config.type === "hero") {

    // 用户要求：这一栏不要长段说明，就放两个框——有装备显示图标，空的就是空框
    const block = el("div", "detail-block");
    block.appendChild(el("h4", undefined, "武器槽"));
    const slots = el("div", "equip-slots");
    for (let i = 0; i < EQUIP_SLOTS; i++) {
      const equip = equips[i];
      const slot = el("div", equip ? "equip-slot filled" : "equip-slot");
      if (equip) {
        const wcfg = CARD_BY_ID.get(equip.configId);
        if (wcfg) slot.appendChild(artEl(wcfg, "equip-slot-img"));
        slot.appendChild(el("span", "equip-slot-stat", `+${equip.atk}/+${equip.hp}`));
        if (equip.level === 2) slot.appendChild(el("span", "equip-slot-star", "★"));
        const label = `${wcfg?.name ?? equip.configId}${equip.level === 2 ? " ★★" : ""} · +${equip.atk} 攻 / +${equip.hp} 血`;
        slot.title = opts.onUnequip ? `${label}（点击卸下）` : label;
        if (opts.onUnequip) {
          const uid = equip.uid;
          slot.classList.add("tappable");
          slot.addEventListener("click", () => {
            hideDetail();
            opts.onUnequip!(uid);
          });
        }
      } else {
        slot.appendChild(el("span", "equip-slot-empty", "空"));
        slot.title = "空武器槽";
      }
      slots.appendChild(slot);
    }
    block.appendChild(slots);
    // 一行小字说明合计（两个框本身看不出装备加成后的面板值）
    const sumAtk = equips.reduce((n, e) => n + e.atk, 0);
    const sumHp = equips.reduce((n, e) => n + e.hp, 0);
    block.appendChild(
      el(
        "div",
        "detail-sub",
        sumAtk + sumHp > 0
          ? `自身 ${atk - sumAtk} 攻 / ${hp - sumHp} 血 · 合计 ${atk} 攻 / ${hp} 血`
          : `自身 ${atk} 攻 / ${hp} 血`,
      ),
    );
    panel.appendChild(block);
  }

  if (config.skill) {
    const block = el("div", "detail-block");
    block.appendChild(el("h4", undefined, `主动技能 · ${config.skill.name}`));
    block.appendChild(el("div", undefined, config.skill.desc));
    panel.appendChild(block);
  }

  if (config.passives.length > 0) {
    const block = el("div", "detail-block");
    block.appendChild(el("h4", undefined, "被动"));
    for (const passive of config.passives) {
      block.appendChild(el("div", undefined, passive.desc ?? `${passive.trigger} → ${passive.effect}`));
    }
    panel.appendChild(block);
  }

  if (config.region || config.professions.length > 0) {
    const block = el("div", "detail-block");
    block.appendChild(el("h4", undefined, "羁绊（点击查看阵营）"));
    const rows = opts.player ? traitRowsOf(opts.player) : [];
    const ids = [config.region, ...config.professions].filter((x): x is NonNullable<typeof x> => Boolean(x));
    const list = el("div", "detail-traits");
    for (const id of ids) {
      const cfg = TRAIT_BY_ID.get(id as never);
      if (!cfg) continue;
      const active = rows.find((r) => r.id === id);
      const row = el("div", "detail-trait-row");
      row.appendChild(el("span", "tname", cfg.name));
      const stateText = active
        ? `当前 ${active.count} 人 · ${active.tier === 1 ? "4 人档" : active.tier === 0 ? "2 人档" : "未激活"}`
        : "当前 0 人 · 未激活";
      row.appendChild(el("span", `tstate ${active && active.tier >= 0 ? "on" : ""}`, stateText));
      row.appendChild(el("span", "tag", "查看 ▸"));
      row.addEventListener("click", () => showTraitDetail(String(id), opts.player));
      list.appendChild(row);
    }
    block.appendChild(list);
    panel.appendChild(block);
  }

  openPanel(host, panel);
}

/* ══════════════ 羁绊详情（阵营 + 效果） ══════════════ */

export function showTraitDetail(traitId: string, player?: PlayerState): void {
  const cfg = TRAIT_BY_ID.get(traitId as never);
  const host = hostDetail();
  if (!cfg || !host) return;

  const counts = player ? traitCountsOfConfigIds(player.board.filter((c): c is CardInstance => c !== null).map((c) => c.configId)) : new Map<string, number>();
  const count = counts.get(cfg.id) ?? 0;
  const tier = tierIndexFor(cfg.id, count);

  const members = HERO_CARDS.filter((c) =>
    cfg.kind === "region" ? c.region === cfg.id : c.professions.includes(cfg.id as never),
  );
  const ownedIds = new Set((player?.board ?? []).filter((c): c is CardInstance => c !== null).map((c) => c.configId));
  const ownedHeroes = (player?.hand ?? []).map((c) => c.configId);
  const ownedLevel = new Map<string, 1 | 2>();
  for (const c of player?.board ?? []) {
    if (c) ownedLevel.set(c.configId, c.level);
  }

  const panel = el("div", "panel");
  panel.appendChild(
    el("div", "panel-title", `${cfg.kind === "region" ? "地区" : "职业"}羁绊 · ${cfg.name}`),
  );

  const statRow = el("div", "detail-stat-row");
  const addStat = (label: string, value: string, cls = "") => {
    const s = el("span", `detail-stat ${cls}`);
    s.appendChild(el("span", undefined, label));
    s.appendChild(el("b", undefined, value));
    statRow.appendChild(s);
  };
  addStat("当前人数", `${count}/${members.length}`, count > 0 ? "gold" : "");
  addStat("激活档位", tier === 1 ? "4 人档" : tier === 0 ? "2 人档" : "未激活", tier >= 0 ? "gold" : "");
  panel.appendChild(statRow);

  const tierBlock = el("div", "detail-block");
  tierBlock.appendChild(el("h4", undefined, "羁绊效果"));
  const tiers: [number, string][] = [
    [cfg.thresholds[0], cfg.desc[0]],
    [cfg.thresholds[1], cfg.desc[1]],
  ];
  for (const [need, desc] of tiers) {
    const on = count >= need;
    const row = el("div", `trait-tier-row ${on ? "on" : ""}`);
    row.appendChild(el("span", "tt-count", `${need} 个`));
    row.appendChild(el("span", "tt-desc", desc));
    tierBlock.appendChild(row);
  }
  panel.appendChild(tierBlock);

  const memberBlock = el("div", "detail-block");
  memberBlock.appendChild(
    el("h4", undefined, `阵营英雄 ${members.filter((m) => ownedIds.has(m.id)).length}/${members.length}`),
  );
  const grid = el("div", "trait-member-grid");
  for (const m of members) {
    const owned = ownedIds.has(m.id);
    const cell = el("div", `trait-member ${owned ? "owned" : ""}`);
    cell.appendChild(artEl(m, "tm-img"));
    if (ownedLevel.has(m.id)) cell.appendChild(el("span", "tm-lv", ownedLevel.get(m.id) === 2 ? "★★" : "★"));
    cell.title = `${m.name} · ${QUALITY_LABEL[m.quality]}卡 ${m.price} 金${
      owned ? " · 已上阵" : ownedHeroes.includes(m.id) ? " · 在仓库" : ""
    }`;
    cell.addEventListener("click", () => showCardDetail(m.id, { player }));
    grid.appendChild(cell);
  }
  memberBlock.appendChild(grid);
  panel.appendChild(memberBlock);

  openPanel(host, panel);
}

/* ══════════════ 对手上回合阵容 ══════════════ */

export function showOpponentDetail(state: GameState, oppId: number): void {
  const host = hostDetail();
  const opp = state.players[oppId];
  if (!host || !opp) return;

  const panel = el("div", "panel");
  panel.appendChild(el("div", "panel-title", oppId === 0 ? "我方阵容" : "对手上回合阵容"));

  const head = el("div", "opp-head");
  head.appendChild(el("div", "oh-face", oppId === 0 ? "你" : `P${oppId}`));
  const meta = el("div", "detail-meta");
  meta.appendChild(el("div", "oh-name", oppId === 0 ? "你" : `玩家 ${oppId}`));
  meta.appendChild(
    el(
      "div",
      "oh-meta",
      `血量 ${opp.hp}/${damageConfig.initialHp} · 商店 Lv${opp.shopLevel} · 战力 ${boardPower(opp)}` +
        (opp.rank !== null ? ` · 第 ${opp.rank} 名` : "") +
        (opp.eliminated ? " · 已淘汰" : ""),
    ),
  );
  head.appendChild(meta);
  panel.appendChild(head);

  const grid = el("div", "lineup-grid");
  for (let pos = 1; pos <= 6; pos++) {
    const cell = el("div", "lineup-cell");
    const c = opp.board[pos - 1] ?? null;
    if (!c) {
      cell.classList.add("empty");
      cell.textContent = `${pos}${pos <= 3 ? "前" : "后"}·空`;
    } else {
      const config = CARD_BY_ID.get(c.configId)!;
      const face = el("div", "lineup-face");
      face.appendChild(artEl(config, "ln-img"));
      cell.appendChild(face);
      const info = el("div", "lineup-info");
      info.appendChild(el("div", "ln", `${config.name}${c.level === 2 ? "★" : ""}`));
      info.appendChild(el("div", "ls", `攻${totalAtk(c)} 血${totalHp(c)}${c.equips.length ? " ⚔" + c.equips.length : ""}`));
      cell.appendChild(info);
      cell.addEventListener("click", () =>
        showCardDetail(c.configId, { level: c.level, atk: totalAtk(c), hp: totalHp(c), equips: c.equips, player: opp }),
      );
    }
    grid.appendChild(cell);
  }
  panel.appendChild(grid);
  panel.appendChild(
    el("div", "detail-sub", "提示：对手在商店阶段会调整阵容，这里显示的是他上一场战斗使用的站位。"),
  );

  openPanel(host, panel);
}

/* ══════════════ 设置面板 ══════════════ */

export function showSettings(handlers: {
  onExitToMenu: () => void;
  onRestart: () => void;
  onCompendium: () => void;
}): void {
  const host = hostDetail();
  if (!host) return;
  const panel = el("div", "panel");
  panel.appendChild(el("div", "panel-title", "设置"));

  const list = el("div", "settings-list");
  const item = (label: string, sub: string, danger: boolean, fn: () => void) => {
    const row = el("button", `settings-item ${danger ? "danger" : ""}`) as HTMLButtonElement;
    row.appendChild(el("span", "si-label", label));
    row.appendChild(el("span", "si-sub", sub));
    row.addEventListener("click", () => {
      hideDetail();
      fn();
    });
    list.appendChild(row);
  };

  item("退出到主菜单", "结束当前对局，回到开始界面", true, handlers.onExitToMenu);
  item("重新开始本局", "用同一个 seed 重开（方便复现）", false, handlers.onRestart);
  item("图鉴", "查看全部英雄与武器", false, handlers.onCompendium);
  panel.appendChild(list);

  panel.appendChild(
    el(
      "div",
      "detail-block",
      "本原型为本地非商业试玩：英雄立绘与装备图标来自 Riot Data Dragon 官方静态资源，仅缓存在本机、不随仓库分发；未获 Riot Games 背书。公开发布或商业化前必须重新核对官方政策并替换为原创素材。",
    ),
  );
  openPanel(host, panel);
}

/* ══════════════ 图鉴 ══════════════ */

export type CodexTab = "all" | "hero" | "weapon";

export function showCompendium(initialTab: CodexTab = "all", player?: PlayerState): void {
  const host = document.getElementById("codex");
  if (!host) return;

  let tab: CodexTab = initialTab;
  let quality = "all";

  const panel = el("div", "panel codex-panel");
  const head = el("div", "codex-head");
  head.appendChild(el("div", "panel-title", "图鉴"));
  const close = el("div", "codex-close", "✕");
  close.addEventListener("click", hideCompendium);
  head.appendChild(close);
  panel.appendChild(head);

  const tabs = el("div", "codex-tabs");
  const filterRow = el("div", "codex-filter");
  const grid = el("div", "codex-grid");
  const count = el("div", "codex-count");
  panel.appendChild(tabs);
  panel.appendChild(filterRow);
  panel.appendChild(grid);
  panel.appendChild(count);

  const QUALITIES = ["all", "green", "blue", "purple", "orange", "gold"] as const;
  const QUALITY_TEXT: Record<string, string> = {
    all: "全部",
    green: "绿",
    blue: "蓝",
    purple: "紫",
    orange: "橙",
    gold: "金",
  };

  function render(): void {
    tabs.replaceChildren();
    for (const [key, label] of [
      ["all", "全部"],
      ["hero", "角色"],
      ["weapon", "武器"],
    ] as [CodexTab, string][]) {
      const b = el("div", `codex-tab ${tab === key ? "on" : ""}`, label);
      b.addEventListener("click", () => {
        tab = key;
        render();
      });
      tabs.appendChild(b);
    }

    filterRow.replaceChildren();
    for (const q of QUALITIES) {
      const b = el("div", `codex-chip ${quality === q ? "on" : ""}`, QUALITY_TEXT[q]!);
      b.addEventListener("click", () => {
        quality = q;
        render();
      });
      filterRow.appendChild(b);
    }

    const pool = CARD_POOL.filter((c) => {
      if (tab === "hero" && c.type !== "hero" && c.type !== "duplicator") return false;
      if (tab === "weapon" && c.type !== "weapon") return false;
      if (quality !== "all" && c.quality !== quality) return false;
      return true;
    }).sort(
      (a, b) =>
        (QUALITY_ORDER[a.quality] ?? 0) - (QUALITY_ORDER[b.quality] ?? 0) || a.name.localeCompare(b.name, "zh"),
    );

    grid.replaceChildren();
    for (const config of pool) {
      const cell = el("div", `codex-cell ${QUALITY_CLASS[config.quality]}`);
      const art = el("div", config.type === "weapon" ? "codex-art weapon" : "codex-art");
      art.appendChild(artEl(config, "codex-img"));
      cell.appendChild(art);
      cell.appendChild(el("div", "codex-name", config.name));
      const stats = el("div", "codex-stats");
      stats.appendChild(el("span", "atk", `${config.atk}`));
      stats.appendChild(el("span", "hp", `${config.hp}`));
      cell.appendChild(stats);
      cell.appendChild(el("div", "codex-sub", config.type === "weapon" ? "武器" : "角色"));
      cell.addEventListener("click", () => showCardDetail(config.id, { player }));
      grid.appendChild(cell);
    }
    count.textContent = `共 ${pool.length} 张 · 点任意卡查看详情`;
  }

  render();
  host.replaceChildren(panel);
  host.classList.remove("hidden");
}

export function hideCompendium(): void {
  const host = document.getElementById("codex");
  if (!host) return;
  host.classList.add("hidden");
  host.replaceChildren();
}

/* ══════════════ 商店概率面板 ══════════════ */

export function showShopOdds(state: GameState): void {
  const host = hostDetail();
  if (!host) return;
  const level = state.players[0]!.shopLevel;
  const panel = el("div", "panel");
  panel.appendChild(el("div", "panel-title", `商店 Lv${level} 刷新概率`));

  const table = el("div", "odds-table");
  const head = el("div", "odds-row odds-head");
  head.appendChild(el("span", undefined, "等级"));
  for (const label of ["绿", "蓝", "紫", "橙", "金"]) head.appendChild(el("span", undefined, label));
  table.appendChild(head);

  for (const row of shopConfig.qualityOdds) {
    const line = el("div", `odds-row ${row.level === level ? "odds-current" : ""}`);
    line.appendChild(el("span", undefined, `Lv${row.level}`));
    for (const key of ["green", "blue", "purple", "orange", "gold"] as const) {
      line.appendChild(el("span", `odds-cell odds-${key}`, row[key] > 0 ? `${row[key]}%` : "—"));
    }
    table.appendChild(line);
  }
  panel.appendChild(table);
  panel.appendChild(
    el("div", "detail-sub", `刷新一次 ${shopConfig.refreshCost} 金币；橙卡从 Lv4 开始出现。价格：绿 1 / 蓝 2 / 紫 3 / 橙 4 / 金 4。`),
  );
  openPanel(host, panel);
}

/* ══════════════ 准备阶段 ══════════════ */

export function showPrepareOverlay(preview: TurnPreview, onFight: () => void, state?: GameState): void {
  const overlay = getOverlay();
  overlay.replaceChildren();
  overlay.classList.remove("hidden");
  const panel = el("div", "panel");
  panel.appendChild(el("div", "panel-title", "⚔ 对手匹配"));

  const row = el("div", "prepare-row");
  row.appendChild(el("span", undefined, preview.opponentId === null ? "本轮轮空" : `对手：玩家 ${preview.opponentId}`));
  row.appendChild(
    el(
      "span",
      preview.amFirst ? "prepare-badge prepare-first" : "prepare-badge prepare-second",
      preview.amFirst ? "你 · 先手" : "你 · 后手",
    ),
  );
  panel.appendChild(row);

  if (state) {
    const oppId = preview.opponentId;
    const mine = state.players[0]!;
    panel.appendChild(el("div", "detail-sub", `我方阵容（战力 ${boardPower(mine)}）`));
    panel.appendChild(lineupGrid(mine));
    if (oppId !== null) {
      const opp = state.players[oppId]!;
      panel.appendChild(el("div", "detail-sub", `对手阵容（战力 ${boardPower(opp)}）`));
      panel.appendChild(lineupGrid(opp));
    }
  }

  const fight = el("button", "btn btn-gold", "开战 ▶");
  fight.style.padding = "11px";
  fight.style.fontSize = "15px";
  fight.addEventListener("click", () => {
    overlay.classList.add("hidden");
    onFight();
  });
  panel.appendChild(fight);
  overlay.appendChild(panel);
}

function lineupGrid(p: PlayerState): HTMLElement {
  const grid = el("div", "lineup-grid");
  for (let pos = 1; pos <= 6; pos++) {
    const cell = el("div", "lineup-cell");
    const c = p.board[pos - 1] ?? null;
    if (!c) {
      cell.classList.add("empty");
      cell.textContent = pos <= 3 ? "前" : "后";
    } else {
      const config = CARD_BY_ID.get(c.configId)!;
      const face = el("div", "lineup-face");
      face.appendChild(artEl(config, "ln-img"));
      cell.appendChild(face);
      const info = el("div", "lineup-info");
      info.appendChild(el("div", "ln", `${config.name}${c.level === 2 ? "★" : ""}`));
      info.appendChild(el("div", "ls", `攻${totalAtk(c)} 血${totalHp(c)}${c.equips.length ? " ⚔" + c.equips.length : ""}`));
      cell.appendChild(info);
    }
    grid.appendChild(cell);
  }
  return grid;
}

/** 阵容战力粗估（仅展示用：攻 × 2 + 生命 + 星级加成） */
export function boardPower(p: PlayerState): number {
  let sum = 0;
  for (const c of p.board) {
    if (!c) continue;
    sum += totalAtk(c) * 2 + totalHp(c) + (c.level === 2 ? 10 : 0);
  }
  return sum;
}

/* ══════════════ 战斗视图（上下两块棋盘 + 金色分割线） ══════════════ */

interface UnitView {
  uid: number;
  name: string;
  hp: number;
  maxHp: number;
  shield: number;
  mana: number;
  maxMana: number;
  root: HTMLElement;
  hpFill: HTMLElement;
  shieldFill: HTMLElement;
  manaFill: HTMLElement;
  hpText: HTMLElement;
  atkText: HTMLElement;
  hpText2: HTMLElement;
  statusBox: HTMLElement;
  ko: HTMLElement;
}

const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));
const INSTANT_EVENTS = new Set<BattleEvent["type"]>(["MANA_CHANGE", "STATUS_REMOVE", "COMBINE", "BATTLE_START", "MAP_EFFECT"]);

function floatText(root: HTMLElement, text: string, cls: string): void {
  const node = el("div", `float ${cls}`, text);
  root.appendChild(node);
  window.setTimeout(() => node.remove(), 850);
}

export function showBattleView(events: BattleEvent[], onDone: () => void, meId = 0): void {
  const overlay = getOverlay();
  overlay.replaceChildren();
  overlay.classList.remove("hidden");
  const start = events[0]!;
  if (start.type !== "BATTLE_START") throw new Error("showBattleView: 事件流缺少 BATTLE_START");
  const meSide: "a" | "b" = start.a === meId ? "a" : "b";
  const enemySide: "a" | "b" = meSide === "a" ? "b" : "a";
  const boards: { a: BattleUnitSnapshot[]; b: BattleUnitSnapshot[] } = start.boards;

  const root = el("div", "battle-root");
  const units = new Map<number, UnitView>();
  let finished = false;
  let instant = false;
  let myDamage = 0;
  let foeDamage = 0;

  function syncUnit(u: UnitView): void {
    u.hpFill.style.width = `${u.maxHp > 0 ? Math.max(0, (u.hp / u.maxHp) * 100) : 0}%`;
    u.hpText.textContent = `${Math.max(0, u.hp)}/${u.maxHp}`;
    u.shieldFill.style.width = `${u.maxHp > 0 ? Math.min(100, (u.shield / u.maxHp) * 100) : 0}%`;
    u.manaFill.style.width = `${u.maxMana > 0 ? Math.min(100, (u.mana / u.maxMana) * 100) : 0}%`;
    u.root.classList.toggle("unit-shielded", u.shield > 0);
    const dead = u.hp <= 0;
    u.root.classList.toggle("unit-dead", dead);
    u.ko.style.display = dead ? "flex" : "none";
  }

  function pulse(node: HTMLElement, cls: string, ms: number): void {
    node.classList.remove(cls);
    void node.offsetWidth;
    node.classList.add(cls);
    window.setTimeout(() => node.classList.remove(cls), ms);
  }

  function makeUnit(snap: BattleUnitSnapshot): HTMLElement {
    const config = CARD_BY_ID.get(snap.configId)!;
    const unit = el("div", `battle-unit ${QUALITY_CLASS[config.quality]}`);

    const frame = el("div", "bu-frame");
    frame.appendChild(artEl(config));
    frame.appendChild(el("div", "bu-shade"));
    frame.appendChild(el("div", "bu-burst"));
    const ko = el("div", "bu-ko", "消灭");
    ko.style.display = "none";
    frame.appendChild(ko);
    unit.appendChild(frame);

    const statusBox = el("div", "bu-status");
    const topRow = el("div", "bu-top");
    topRow.appendChild(el("div", "bu-name", `${config.name}${snap.level === 2 ? "★" : ""}`));
    topRow.appendChild(statusBox);
    unit.appendChild(topRow);

    // 点单位看状态（含对手）；战斗中播放不打断
    unit.classList.add("tappable");
    unit.addEventListener("click", () => showBattleUnitDetail(snap, snap.owner === meId));

    const atkText = el("div", "bu-atk", String(snap.atk));
    const hpText2 = el("div", "bu-hp", String(snap.hp));
    unit.appendChild(atkText);
    unit.appendChild(hpText2);

    const bars = el("div", "bu-bars");
    const hpbar = el("div", "bu-hpbar");
    const hpFill = el("div", "bu-hpfill");
    const shieldFill = el("div", "bu-shieldfill");
    hpbar.appendChild(hpFill);
    hpbar.appendChild(shieldFill);
    bars.appendChild(hpbar);
    const hpText = el("div", "bu-hptext", `${snap.hp}/${snap.maxHp}`);
    bars.appendChild(hpText);
    const manaFill = el("div", "bu-manafill");
    if (snap.maxMana > 0) {
      const manabar = el("div", "bu-manabar");
      manabar.appendChild(manaFill);
      bars.appendChild(manabar);
    }
    unit.appendChild(bars);

    // 武器条：卡面底部显示已装备的武器图标（最多 2 格，和棋盘卡一致）
    if (snap.equips && snap.equips.length > 0) {
      const slot = el("div", "bu-weapon");
      slot.dataset.count = String(Math.min(snap.equips.length, EQUIP_SLOTS));
      for (const equip of snap.equips.slice(0, EQUIP_SLOTS)) {
        const wcfg = CARD_BY_ID.get(equip.configId);
        if (wcfg) slot.appendChild(artEl(wcfg, "bu-weapon-icon"));
      }
      slot.title = snap.equips
        .map((e) => {
          const w = CARD_BY_ID.get(e.configId);
          return `${w?.name ?? e.configId}${e.level === 2 ? " ★★" : ""}（+${e.atk}攻 +${e.hp}血）`;
        })
        .join("　");
      frame.appendChild(slot);
    }

    const view: UnitView = {
      uid: snap.uid,
      name: config.name,
      hp: snap.hp,
      maxHp: snap.maxHp,
      shield: snap.shield,
      mana: snap.mana,
      maxMana: snap.maxMana,
      root: unit,
      hpFill,
      shieldFill,
      manaFill,
      hpText,
      atkText,
      hpText2,
      statusBox,
      ko,
    };
    units.set(snap.uid, view);
    syncUnit(view);
    return unit;
  }

  /** 一块半场：2 列 × 3 行（右列是前排），按给定的位置顺序铺 */
  function buildHalf(label: string, first: boolean, order: number[], snaps: BattleUnitSnapshot[]): HTMLElement {
    const box = el("div", "battle-side");
    const labelEl = el("div", "battle-side-label");
    labelEl.appendChild(el("span", undefined, label));
    labelEl.appendChild(el("span", "first-badge", first ? "先手" : "后手"));
    box.appendChild(labelEl);
    const grid = el("div", "battle-grid");
    for (const pos of order) {
      const cell = el("div", "battle-cell");
      const snap = snaps.find((s) => s.position === pos);
      if (snap) cell.appendChild(makeUnit(snap));
      grid.appendChild(cell);
    }
    box.appendChild(grid);
    return box;
  }

  // 竖屏：对手在上、我方在下，中间是横分割线；双方前排都贴着分割线
  const body = el("div", "battle-body");
  const foe = buildHalf(
    `对手 玩家${start.a === meId ? start.b : start.a}`,
    start.a !== meId,
    [4, 5, 6, 1, 2, 3],
    boards[enemySide],
  );
  foe.classList.add("side-foe");
  body.appendChild(foe);

  const divider = el("div", "battle-divider");
  divider.appendChild(el("div", "divider-ret", "✛"));
  body.appendChild(divider);

  const mine = buildHalf("你", start.a === meId, [1, 2, 3, 4, 5, 6], boards[meSide]);
  mine.classList.add("side-mine");
  body.appendChild(mine);
  root.appendChild(body);

  const foot = el("div", "battle-foot");
  const action = el("div", "battle-action", "战斗开始！");
  foot.appendChild(action);
  const stats = el("div", "battle-stats");
  const statsMe = el("div", undefined, "我方输出 0");
  const statsFoe = el("div", undefined, "对方输出 0");
  stats.appendChild(statsMe);
  stats.appendChild(statsFoe);
  foot.appendChild(stats);
  const resultEl = el("div", "battle-result");
  foot.appendChild(resultEl);
  root.appendChild(foot);

  const controls = el("div", "battle-controls");
  const SPEEDS = [
    { label: "▶ 原速", ms: 300 },
    { label: "⏩ 2×", ms: 140 },
    { label: "⏭ 3×", ms: 60 },
  ];
  let speedIdx = 0;
  const btnSpeed = el("button", "btn", SPEEDS[0]!.label);
  btnSpeed.addEventListener("click", () => {
    speedIdx = (speedIdx + 1) % SPEEDS.length;
    btnSpeed.textContent = SPEEDS[speedIdx]!.label;
  });
  controls.appendChild(btnSpeed);
  const btnSkip = el("button", "btn", "跳过");
  btnSkip.addEventListener("click", () => {
    instant = true;
    btnSkip.disabled = true;
  });
  controls.appendChild(btnSkip);
  const btnDone = el("button", "btn btn-gold", "继续 ▶");
  btnDone.classList.add("hidden");
  btnDone.addEventListener("click", () => {
    overlay.classList.add("hidden");
    onDone();
  });
  controls.appendChild(btnDone);
  root.appendChild(controls);
  overlay.appendChild(root);

  function statusBadge(u: UnitView, id: StatusId, on: boolean): void {
    const existing = u.statusBox.querySelector(`[data-st="${id}"]`);
    if (on) {
      if (existing) return;
      const b = el("span", `bu-st ${STATUS_CLASS[id]}`, STATUS_LABEL[id]);
      b.dataset.st = id;
      u.statusBox.appendChild(b);
    } else {
      existing?.remove();
    }
  }

  function clearActing(): void {
    for (const u of units.values()) u.root.classList.remove("acting");
  }

  function applyEvent(e: BattleEvent): void {
    switch (e.type) {
      case "ATTACK": {
        const from = units.get(e.from);
        const to = units.get(e.to);
        action.textContent = `${from?.name ?? `#${e.from}`} 普攻 ${to?.name ?? `#${e.to}`}`;
        clearActing();
        if (from) {
          from.root.classList.add("acting");
          pulse(from.root, "attacking", 320);
        }
        if (to) pulse(to.root, "hit", 300);
        break;
      }
      case "SKILL_CAST": {
        const caster = units.get(e.caster);
        action.textContent = `✨ ${caster?.name ?? `#${e.caster}`} 施放【${e.skillName}】`;
        clearActing();
        if (caster) {
          caster.root.classList.add("acting");
          pulse(caster.root, "casting", 560);
          floatText(caster.root, e.skillName, "skill");
          const banner = el("div", "skill-banner", e.skillName);
          floatHost().appendChild(banner);
          window.setTimeout(() => banner.remove(), 900);
        }
        break;
      }
      case "DAMAGE": {
        const to = units.get(e.target);
        if (!to) break;
        to.hp = e.remainingHp;
        if (e.absorbed > 0) {
          to.shield = Math.max(0, to.shield - e.absorbed);
          floatText(to.root, `护盾 -${e.absorbed}`, "shield-dmg");
        }
        syncUnit(to);
        if (e.amount > 0) {
          to.hpText2.textContent = String(Math.max(0, to.hp));
          floatText(to.root, `-${e.amount}`, "dmg");
          if (boards[meSide].some((s) => s.uid === e.target)) foeDamage += e.amount;
          else myDamage += e.amount;
          statsMe.textContent = `我方输出 ${myDamage}`;
          statsFoe.textContent = `对方输出 ${foeDamage}`;
          if (e.amount >= Math.max(6, to.maxHp * 0.5)) pulse(root, "shake", 230);
        }
        break;
      }
      case "HEAL": {
        const to = units.get(e.target);
        if (!to) break;
        to.hp = e.remainingHp;
        to.hpText2.textContent = String(to.hp);
        syncUnit(to);
        floatText(to.root, `+${e.amount}`, "heal");
        action.textContent = `${to.name} 回复 ${e.amount} 生命`;
        break;
      }
      case "SHIELD_GAIN": {
        const to = units.get(e.target);
        if (!to) break;
        to.shield = e.totalShield;
        syncUnit(to);
        floatText(to.root, `护盾 +${e.amount}`, "shield");
        break;
      }
      case "SHIELD_BREAK": {
        const to = units.get(e.target);
        if (!to) break;
        to.shield = 0;
        syncUnit(to);
        floatText(to.root, "破盾", "break");
        pulse(to.root, "hit", 300);
        break;
      }
      case "STATUS_APPLY": {
        const to = units.get(e.target);
        if (!to) break;
        statusBadge(to, e.status, true);
        floatText(to.root, STATUS_LABEL[e.status], "status");
        break;
      }
      case "STATUS_REMOVE": {
        const to = units.get(e.target);
        if (to) statusBadge(to, e.status, false);
        break;
      }
      case "MANA_CHANGE": {
        const u = units.get(e.who);
        if (!u) break;
        u.mana = e.after;
        syncUnit(u);
        break;
      }
      case "JUMP": {
        const u = units.get(e.who);
        if (!u) break;
        pulse(u.root, "jumping", 460);
        floatText(u.root, "切后排", "jump");
        break;
      }
      case "REVIVE": {
        const u = units.get(e.who);
        if (!u) break;
        u.hp = e.hp;
        u.hpText2.textContent = String(e.hp);
        syncUnit(u);
        pulse(u.root, "reviving", 620);
        floatText(u.root, "时空回溯", "revive");
        action.textContent = `${u.name} 触发时空回溯！`;
        break;
      }
      case "TRAIT_TRIGGER": {
        action.textContent = `羁绊【${traitName(e.trait as never)}】${e.tier === 1 ? "4" : "2"} 人档生效`;
        break;
      }
      case "MAP_EFFECT": {
        const map = MAP_BY_ID.get(e.mapId as MapId);
        action.textContent = `地图【${map?.name ?? e.mapId}】${map?.desc ?? ""}`;
        break;
      }
      case "DEATH": {
        const u = units.get(e.who);
        if (u) {
          u.hp = 0;
          u.hpText2.textContent = "0";
          syncUnit(u);
          pulse(root, "shake", 230);
        }
        action.textContent = `${u?.name ?? `#${e.who}`} 被消灭`;
        break;
      }
      case "BATTLE_END": {
        if (e.winner === meId) {
          resultEl.textContent = "🏆 胜利";
          resultEl.style.color = "var(--gold-2)";
        } else if (e.winner === null) {
          resultEl.textContent = "⚖ 平局";
          resultEl.style.color = "var(--text)";
        } else {
          resultEl.textContent = "💀 失败";
          resultEl.style.color = "#ff8b95";
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
    try {
      for (const e of events.slice(1)) {
        if (finished) break;
        applyEvent(e);
        if (instant || INSTANT_EVENTS.has(e.type)) continue;
        await sleep(SPEEDS[speedIdx]!.ms);
      }
    } catch (err) {
      // 播放层绝不能把玩家卡死：出错也把「继续」放出来
      console.error("[battle] 播放事件时出错", err);
      action.textContent = "战斗播放出错，已跳过剩余动画";
    } finally {
      finished = true;
      clearActing();
      btnDone.classList.remove("hidden");
    }
  })();
}

/* ══════════════ 终局 / 通用 ══════════════ */

export function showFinalOverlay(ranking: PlayerState[], onRestart: () => void, meId = 0): void {
  const overlay = getOverlay();
  overlay.replaceChildren();
  overlay.classList.remove("hidden");
  const panel = el("div", "panel");
  panel.appendChild(el("div", "panel-title", "🏆 对局结束"));
  const list = el("div", "final-list");
  for (const p of ranking) {
    const row = el("div", p.id === meId ? "final-row final-me" : "final-row");
    row.appendChild(el("span", "final-rank", `${p.rank}`));
    row.appendChild(el("span", "fname", p.id === meId ? "你" : `玩家${p.id}`));
    row.appendChild(el("span", "fhp", `剩余血量 ${p.hp}`));
    list.appendChild(row);
  }
  panel.appendChild(list);
  const btn = el("button", "btn btn-gold", "再来一局 ↻");
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
  (toast as unknown as { _t?: number })._t = window.setTimeout(() => toast.classList.add("hidden"), 2200);
}

export function cardNameOf(uid: number, state: GameState): string {
  for (const p of state.players) {
    const c = [...p.hand, ...p.board].find((x) => x !== null && x.uid === uid);
    if (c) return cardName(c);
  }
  return `#${uid}`;
}

/** 图鉴排序辅助（UI 预留：按品质再按名称） */
export function sortByQuality(cards: CardConfig[]): CardConfig[] {
  return [...cards].sort(
    (a, b) => (QUALITY_ORDER[a.quality] ?? 0) - (QUALITY_ORDER[b.quality] ?? 0) || a.name.localeCompare(b.name),
  );
}
