import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { makeCtx, place, battleCtx, giveHand } from "./helpers";
import { createGame } from "../core/state";
import { createRng } from "../core/rng";
import { beginRound } from "../core/phase";
import { runBattle } from "../core/battle";

/**
 * Web 渲染层烟测（T-F）
 * 项目不引入 jsdom 等依赖，这里用一个最小 DOM 假实现跑真实渲染代码：
 * 目标是抓出"渲染路径抛异常 / 关键文案缺失 / 缺图回退失效"这类只有运行才会暴露的问题。
 */

/* ══════════════ 最小 DOM 假实现 ══════════════ */

class FakeClassList {
  constructor(private owner: FakeEl) {}
  add(...names: string[]): void {
    for (const n of names) if (n) this.owner.classSet.add(n);
  }
  remove(...names: string[]): void {
    for (const n of names) this.owner.classSet.delete(n);
  }
  toggle(name: string, force?: boolean): boolean {
    const on = force ?? !this.owner.classSet.has(name);
    if (on) this.owner.classSet.add(name);
    else this.owner.classSet.delete(name);
    return on;
  }
  contains(name: string): boolean {
    return this.owner.classSet.has(name);
  }
}

class FakeEl {
  tagName: string;
  id = "";
  textContent = "";
  title = "";
  src = "";
  alt = "";
  decoding = "";
  disabled = false;
  onclick: (() => void) | null = null;
  offsetWidth = 0;
  dataset: Record<string, string> = {};
  style: Record<string, unknown> = {};
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  listeners: Record<string, ((e: unknown) => void)[]> = {};
  /** 类名集合：className 与 classList 共享同一份数据 */
  readonly classSet = new Set<string>();
  readonly classList: FakeClassList;

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
    this.classList = new FakeClassList(this);
  }

  get className(): string {
    return [...this.classSet].join(" ");
  }

  set className(value: string) {
    this.classSet.clear();
    for (const n of value.split(/\s+/)) if (n) this.classSet.add(n);
  }

  get childElementCount(): number {
    return this.children.length;
  }

  appendChild<T extends FakeEl>(child: T): T {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  replaceChildren(...nodes: FakeEl[]): void {
    this.children = [];
    for (const n of nodes) this.appendChild(n);
  }

  remove(): void {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }

  replaceWith(next: FakeEl): void {
    const parent = this.parent;
    if (!parent) return;
    const idx = parent.children.indexOf(this);
    if (idx >= 0) parent.children[idx] = next;
    next.parent = parent;
    this.parent = null;
  }

  addEventListener(type: string, fn: (e: unknown) => void): void {
    (this.listeners[type] ??= []).push(fn);
  }

  removeEventListener(type: string, fn: (e: unknown) => void): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn);
  }

  /** 仅供测试：触发注册过的监听器 */
  fire(type: string, event: unknown = {}): void {
    for (const fn of this.listeners[type] ?? []) fn(event);
  }

  descendants(): FakeEl[] {
    const out: FakeEl[] = [];
    for (const c of this.children) {
      out.push(c, ...c.descendants());
    }
    return out;
  }

  querySelector(selector: string): FakeEl | null {
    return this.descendants().find((e) => matches(e, selector)) ?? null;
  }

  querySelectorAll(selector: string): FakeEl[] {
    return this.descendants().filter((e) => matches(e, selector));
  }

  closest(selector: string): FakeEl | null {
    let node: FakeEl | null = this;
    while (node) {
      if (matches(node, selector)) return node;
      node = node.parent;
    }
    return null;
  }
}

function matches(el: FakeEl, selector: string): boolean {
  if (selector.startsWith("[") && selector.endsWith("]")) {
    const body = selector.slice(1, -1);
    const [key, rawValue] = body.split("=");
    const attr = key!.startsWith("data-") ? key!.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()) : key!;
    if (rawValue === undefined) return (el.dataset as Record<string, string>)[attr!] !== undefined;
    return (el.dataset as Record<string, string>)[attr!] === rawValue.replace(/"/g, "");
  }
  if (selector.startsWith(".")) {
    // 支持复合类选择器（如 .roster-cell.voted）
    return selector
      .slice(1)
      .split(".")
      .every((cls) => el.classList.contains(cls));
  }
  if (selector.startsWith("#")) return el.id === selector.slice(1);
  return el.tagName === selector.toUpperCase();
}

/** 页面里 index.html 提供的容器 id */
const PAGE_IDS = [
  "vignette",
  "topbar",
  "stage",
  "main",
  "side",
  "shoppanel",
  "shop",
  "shopbtns",
  "readybar",
  "ready",
  "arena",
  "arena-mark",
  "board",
  "bottom",
  "hand",
  "weapons",
  "opps",
  "traits",
  "detail",
  "overlay",
  "toast",
  "start",
  "match",
];

let registry: Map<string, FakeEl>;

function installDom(): void {
  registry = new Map();
  for (const id of PAGE_IDS) {
    const node = new FakeEl("div");
    node.id = id;
    registry.set(id, node);
  }
  const doc = {
    createElement: (tag: string) => new FakeEl(tag),
    getElementById: (id: string) => registry.get(id) ?? null,
    elementFromPoint: () => null,
  };
  const win = {
    get setTimeout() {
      return globalThis.setTimeout;
    },
    get clearTimeout() {
      return globalThis.clearTimeout;
    },
    get setInterval() {
      return globalThis.setInterval;
    },
    get clearInterval() {
      return globalThis.clearInterval;
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  (globalThis as unknown as { document: unknown }).document = doc;
  (globalThis as unknown as { window: unknown }).window = win;
}

function byText(root: FakeEl, text: string): FakeEl | null {
  if (root.textContent.includes(text)) return root;
  for (const c of root.children) {
    const found = byText(c, text);
    if (found) return found;
  }
  return null;
}

function freshState(seed = 88) {
  const state = createGame(seed, null, { startingLoadout: false });
  const rng = createRng(seed);
  beginRound(state, rng);
  return { state, rng };
}

describe("Web 渲染层烟测（最小 DOM 假实现）", () => {
  beforeEach(() => {
    installDom();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("商店渲染出 3 张带立绘、技能与价格的卡（卡面不展示地区/职业/法力）", async () => {
    const ui = await import("../web/ui");
    const { state } = freshState();
    state.players[0]!.gold = 99;
    // 固定商店内容，避免依赖随机
    state.players[0]!.shop = ["garen", "jinx", "duplicator"];
    ui.renderShop(state, () => undefined);

    const shop = registry.get("shop")!;
    expect(byText(shop, "盖伦")).not.toBeNull();
    expect(byText(shop, "金克丝")).not.toBeNull();
    expect(byText(shop, "英雄复制器")).not.toBeNull();
    expect(byText(shop, "全体伤害 + 自身护盾")).not.toBeNull(); // 卡面只显示一句话简介
    // 参考图里商店卡只有「技能说明 + 名称 + 价格」
    expect(byText(shop, "德玛西亚")).toBeNull();
    expect(byText(shop, "0/60")).toBeNull();
    expect(byText(shop, "万能合成牌")).not.toBeNull(); // 复制器说明
    // 每张卡都用了本地立绘，alt 是中文名
    const alts = shop.descendants().filter((e) => e.tagName === "IMG").map((e) => e.alt);
    expect(alts).toEqual(["盖伦", "金克丝"]);
  });

  it("缺图时退化为确定性的首字占位（立绘→头像→首字 三级回退）", async () => {
    const ui = await import("../web/ui");
    const { state } = freshState();
    state.players[0]!.shop = ["garen", null, null];
    ui.renderShop(state, () => undefined);
    const shop = registry.get("shop")!;
    const img = shop.descendants().find((e) => e.tagName === "IMG")!;
    expect(img).toBeDefined();
    expect(img.alt).toBe("盖伦");
    expect(img.src).toContain("/assets/lol/portraits/Garen.jpg");
    img.fire("error"); // 立绘失败 → 回退方形头像
    expect(img.src).toContain("/assets/lol/champions/Garen.png");
    img.fire("error"); // 头像也失败 → 首字占位
    expect(byText(shop, "盖")).not.toBeNull();
  });

  it("羁绊面板显示当前人数/下一阈值，并高亮已激活档位", async () => {
    const ui = await import("../web/ui");
    const { state } = freshState();
    const p = state.players[0]!;
    place(state, p, "garen", 1);
    place(state, p, "poppy", 2);
    ui.renderTraits(state);
    const box = registry.get("traits")!;
    expect(byText(box, "羁绊")).not.toBeNull();
    expect(byText(box, "德玛西亚")).not.toBeNull();
    expect(byText(box, "2/4")).not.toBeNull(); // 德玛西亚 2 人 + 先锋 2 人
    expect(byText(box, "2档")).not.toBeNull();
    // 3 人时仍是 2 档，显示 3/4
    place(state, p, "lux", 3);
    ui.renderTraits(state);
    expect(byText(registry.get("traits")!, "3/4")).not.toBeNull();
  });

  it("棋盘 6 个槽位带 data-pos，仓库渲染手牌", async () => {
    const ui = await import("../web/ui");
    const { state } = freshState();
    const p = state.players[0]!;
    place(state, p, "vi", 4);
    p.hand.push(...[]);
    state.nextUid = state.nextUid; // 保持状态可读
    const { createCardInstance } = await import("../core/state");
    p.hand.push(createCardInstance(state, "ahri"));
    ui.renderBoard(state, () => undefined);
    ui.renderHand(state, () => undefined);

    const board = registry.get("board")!;
    const slots = board.querySelectorAll("[data-pos]");
    expect(slots).toHaveLength(6);
    // 竖屏：3 列 × 2 行，DOM 顺序就是 1..6（第一行前排、第二行后排）
    expect(slots.map((s) => s.dataset.pos)).toEqual(["1", "2", "3", "4", "5", "6"]);
    // 对齐参考图：卡面不写字，靠立绘识别；名字仍保留在 img 的 alt 里（无障碍 + 便于断言）
    const boardNames = board.descendants().filter((e) => e.tagName === "IMG").map((e) => e.alt);
    expect(boardNames).toContain("蔚");
    expect(byText(board, "4后")).not.toBeNull();
    const handNames = registry.get("hand")!.descendants().filter((e) => e.tagName === "IMG").map((e) => e.alt);
    expect(handNames).toContain("阿狸");
  });

  it("顶栏/对手条/准备按钮渲染不抛错", async () => {
    const ui = await import("../web/ui");
    const { state } = freshState();
    state.round = 3;
    state.players[0]!.gold = 7;
    state.players[0]!.shopLevel = 2;
    state.players[3]!.eliminated = true;
    state.players[3]!.rank = 8;
    ui.renderTopbar(state);
    ui.renderOppStrip(state);
    ui.renderReadyButton(state, () => undefined);
    expect(byText(registry.get("topbar")!, "Lv2")).not.toBeNull();
    // 金币数值 + 对手血量：顶栏显示 7，对手条上每个玩家显示 30/27
    expect(byText(registry.get("topbar")!, "7")).not.toBeNull();
    expect(byText(registry.get("opps")!, "P3")).not.toBeNull();
    expect(registry.get("ready")!.disabled).toBe(false);
    // 回合数显示在准备按钮里
    expect(byText(registry.get("ready")!, "3")).not.toBeNull();
    expect(byText(registry.get("ready")!, "准备")).not.toBeNull();
  });

  it("战斗回放：技能/护盾/眩晕事件都能落到界面并跑完", async () => {
    vi.useFakeTimers();
    const ui = await import("../web/ui");
    const { state } = makeCtx(4242);
    const p = state.players[0]!;
    const enemy = state.players[1]!;
    const ahri = place(state, p, "ahri", 4); // 后排，先被打
    place(state, p, "garen", 1);
    const foe = place(state, enemy, "taitan", 1);
    foe.hp = 200;
    const ctx = battleCtx(state);
    ctx.byUid.get(ahri.uid)!.mana = ctx.byUid.get(ahri.uid)!.maxMana; // 满法力 → 施放欺诈宝珠
    const events = runBattle(ctx);
    expect(events.some((e) => e.type === "SKILL_CAST")).toBe(true);

    let done = false;
    ui.showBattleView(events, () => {
      done = true;
    });
    await vi.runAllTimersAsync();

    const overlay = registry.get("overlay")!;
    expect(byText(overlay, "你")).not.toBeNull();
    expect(overlay.querySelectorAll(".battle-unit").length).toBeGreaterThanOrEqual(2);
    expect(overlay.querySelectorAll(".bu-manafill").length).toBeGreaterThanOrEqual(1);
    const doneBtn = byText(overlay, "继续 ▶");
    expect(doneBtn).not.toBeNull();
    expect(doneBtn!.classList.contains("hidden")).toBe(false);
    doneBtn!.fire("click");
    expect(done).toBe(true);
  });

  it("终局面板按名次渲染", async () => {
    const ui = await import("../web/ui");
    const { state } = freshState();
    state.players.forEach((pl, i) => {
      pl.rank = i + 1;
    });
    let restarted = false;
    ui.showFinalOverlay([...state.players], () => {
      restarted = true;
    });
    const overlay = registry.get("overlay")!;
    const badges = overlay.querySelectorAll(".final-rank");
    expect(badges.map((b) => b.textContent)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
    expect(byText(overlay, "你")).not.toBeNull();
    expect(byText(overlay, "剩余血量")).not.toBeNull();
    expect(byText(overlay, "再来一局 ↻")).not.toBeNull();
    byText(overlay, "再来一局 ↻")!.fire("click");
    expect(restarted).toBe(true);
  });

  it("showToast 写入提示文案", async () => {
    const ui = await import("../web/ui");
    ui.showToast("✨ 三合一！金卡诞生");
    expect(registry.get("toast")!.textContent).toContain("三合一");
  });

  it("仓库把英雄和武器放在同一条卡槽里，装备后卡面显示武器条", async () => {
    const ui = await import("../web/ui");
    const { state } = freshState();
    const p = state.players[0]!;
    const hero = place(state, p, "garen", 1);
    giveHand(state, p, "ahri");
    // 直接塞一件武器进库存，再用引擎动作装备
    const { createEquipInstance } = await import("../core/state");
    const w = createEquipInstance(state, "infinity_edge");
    p.weapons.push(w);
    ui.renderHand(state, () => undefined);
    const box = registry.get("hand")!;
    // 同一条槽里既有英雄卡也有武器卡
    expect(box.querySelectorAll(".card")).toHaveLength(1); // 阿狸
    expect(box.querySelectorAll(".bench-weapon")).toHaveLength(1); // 无尽之刃
    expect(byText(box, "+8")).not.toBeNull(); // 无尽之刃攻击力（带被动后下调到 8）

    const { applyAction } = await import("../core/actions");
    const { createRng } = await import("../core/rng");
    applyAction(state, createRng(1), { type: "equip", player: 0, weaponUid: w.uid, cardUid: hero.uid });

    ui.renderHand(state, () => undefined);
    expect(registry.get("hand")!.querySelectorAll(".bench-weapon")).toHaveLength(0);

    ui.renderBoard(state, () => undefined);
    expect(registry.get("board")!.querySelectorAll(".card-weapon.has-weapon")).toHaveLength(1);
    expect(registry.get("board")!.querySelectorAll(".cw-icon")).toHaveLength(1);
  });

  it("两个武器槽：卡面武器条显示 2 个图标，装满后再装备会替换较弱的", async () => {
    const ui = await import("../web/ui");
    const { state } = freshState();
    const p = state.players[0]!;
    const hero = place(state, p, "garen", 1);
    const { createEquipInstance } = await import("../core/state");
    const { applyAction } = await import("../core/actions");
    const { createRng } = await import("../core/rng");
    const a = createEquipInstance(state, "long_sword"); // 3/3
    const b = createEquipInstance(state, "chain_vest"); // 2/7
    const c = createEquipInstance(state, "infinity_edge"); // 8/6
    p.weapons.push(a, b, c);
    applyAction(state, createRng(1), { type: "equip", player: 0, weaponUid: a.uid, cardUid: hero.uid });
    applyAction(state, createRng(1), { type: "equip", player: 0, weaponUid: b.uid, cardUid: hero.uid });
    expect(hero.equips).toHaveLength(2);
    ui.renderBoard(state, () => undefined);
    expect(registry.get("board")!.querySelectorAll(".cw-icon")).toHaveLength(2);

    // 装满后再装：替换较弱的（长剑 3*2+3=9 vs 锁子甲 2*2+7=11 → 换掉长剑）
    applyAction(state, createRng(1), { type: "equip", player: 0, weaponUid: c.uid, cardUid: hero.uid });
    expect(hero.equips.map((e) => e.configId).sort()).toEqual(["chain_vest", "infinity_edge"]);
    expect(p.weapons.map((w) => w.configId)).toContain("long_sword");
  });

  it("卡牌详情展示装备加成与自身数值拆分", async () => {
    const ui = await import("../web/ui");
    const { state } = freshState();
    const p = state.players[0]!;
    place(state, p, "garen", 1);
    ui.showCardDetail("garen", {
      atk: 12,
      hp: 13,
      equips: [{ uid: 99, configId: "infinity_edge", level: 1, atk: 9, hp: 6 }],
      player: p,
    });
    const detail = registry.get("detail")!;
    expect(byText(detail, "已装备武器 1/2")).not.toBeNull();
    expect(byText(detail, "无尽之刃")).not.toBeNull();
    expect(byText(detail, " +9 攻 / +6 血")).not.toBeNull();
    expect(byText(detail, "自身 3 攻 / 7 血；含装备后面板合计 12 攻 / 13 血。")).not.toBeNull();
  });

  it("武器详情说明装备规则与万能牌", async () => {
    const ui = await import("../web/ui");
    ui.showCardDetail("hextech_gunblade", { atk: 8, hp: 6 });
    const detail = registry.get("detail")!;
    expect(byText(detail, "装备效果")).not.toBeNull();
    expect(byText(detail, "装备到英雄身上生效")).not.toBeNull();
    expect(detail.descendants().some((e) => (e.textContent ?? "").includes("武器线的万能牌"))).toBe(true);
  });

  it("弹窗层级：卡牌详情 > 图鉴 > 开始界面 > 战斗遮罩（任一错位都会「点了没反应」）", () => {
    const css = readFileSync(path.join(process.cwd(), "web", "style.css"), "utf8");
    const grab = (sel: string) => {
      // 同一个选择器可能在多处出现（例如 #overlay, #detail 合写一次、再单独各写一次），
      // 取最后一次声明了 z-index 的值
      let idx = -1;
      let found = 0;
      for (;;) {
        const i = css.indexOf(`${sel} {`, idx + 1);
        if (i < 0) break;
        idx = i;
        const z = /z-index:\s*(\d+)/.exec(css.slice(i, css.indexOf("}", i)));
        if (z) found = Number(z[1]);
      }
      if (found === 0) throw new Error(`${sel} 没有声明 z-index`);
      return found;
    };
    // 回归 bug：从首页图鉴点角色没反应——详情被图鉴盖住了
    expect(grab("#detail")).toBeGreaterThan(grab("#codex"));
    expect(grab("#codex")).toBeGreaterThan(grab("#start"));
    expect(grab("#start")).toBeGreaterThan(grab("#overlay"));
  });

  it("所有图片容器都是定位元素（缺图占位是 absolute，容器漏了定位会撑满整屏）", () => {
    // 回归守卫：.card-art-fallback 是 absolute + inset:0，
    // 一旦它的容器没有 position:relative，占位块就会相对最近的定位祖先铺满整屏。
    const css = readFileSync(path.join(process.cwd(), "web", "style.css"), "utf8");
    for (const selector of [
      ".card-frame",
      ".codex-art",
      ".detail-art",
      ".lineup-face",
      ".trait-member",
      ".showcase-face",
      ".roster-face",
      ".opp",
      ".map-card",
      ".bu-frame",
    ]) {
      // 优先精确匹配选择器行；找不到再退回"后代选择器结尾"（如 .battle-unit .bu-frame）
      const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      let m = new RegExp(`(?:^|\\n)${esc} \\{`).exec(css);
      if (!m) m = new RegExp(`(?:^|\\n)[^\\n{}]*${esc} \\{`).exec(css);
      expect(m, `缺少样式规则 ${selector}`).not.toBeNull();
      const body = css.slice(m!.index, css.indexOf("}", m!.index));
      expect(body, `${selector} 缺少 position: relative`).toContain("position: relative");
    }
  });

  it("羁绊 chip 带六边形人数徽标与档位", async () => {
    const ui = await import("../web/ui");
    const { state } = freshState();
    const p = state.players[0]!;
    place(state, p, "garen", 1);
    place(state, p, "poppy", 2);
    place(state, p, "lux", 3);
    ui.renderTraits(state);
    const box = registry.get("traits")!;
    const hexes = box.querySelectorAll(".trait-hex");
    expect(hexes.length).toBeGreaterThan(0);
    // 德玛西亚 3 人 → 徽标显示 3
    expect(hexes.map((h) => h.textContent)).toContain("3");
    expect(byText(box, "3/4")).not.toBeNull();
  });

  it("卡牌详情弹窗展示一星/二星数值、技能与羁绊，可关闭", async () => {
    const ui = await import("../web/ui");
    const { state } = freshState();
    const p = state.players[0]!;
    place(state, p, "garen", 1);
    ui.showCardDetail("ahri", { level: 1, atk: 4, hp: 5, player: p });
    const detail = registry.get("detail")!;
    expect(detail.classList.contains("hidden")).toBe(false);
    expect(byText(detail, "阿狸")).not.toBeNull();
    expect(byText(detail, "欺诈宝珠")).not.toBeNull();
    expect(byText(detail, "艾欧尼亚")).not.toBeNull();
    expect(byText(detail, "法师")).not.toBeNull();
    expect(byText(detail, "星级成长")).not.toBeNull();
    // 二星预览：攻 4 → 12，血 5 → 15
    expect(byText(detail, "12")).not.toBeNull();
    expect(byText(detail, "15")).not.toBeNull();
    ui.hideDetail();
    expect(detail.classList.contains("hidden")).toBe(true);
  });

  it("羁绊详情弹窗展示档位效果与阵营英雄网格", async () => {
    const ui = await import("../web/ui");
    const { state } = freshState();
    const p = state.players[0]!;
    place(state, p, "garen", 1);
    place(state, p, "poppy", 2);
    ui.showTraitDetail("demacia", p);
    const detail = registry.get("detail")!;
    expect(byText(detail, "德玛西亚")).not.toBeNull();
    expect(byText(detail, "羁绊效果")).not.toBeNull();
    expect(byText(detail, "2 个")).not.toBeNull();
    expect(byText(detail, "4 个")).not.toBeNull();
    expect(byText(detail, "阵营英雄 2/4")).not.toBeNull();
    const members = detail.querySelectorAll(".trait-member");
    expect(members).toHaveLength(4); // 德玛西亚 4 名英雄
    expect(members.filter((m) => m.classList.contains("owned"))).toHaveLength(2);
  });

  it("对手上回合阵容弹窗展示 6 个站位与战力", async () => {
    const ui = await import("../web/ui");
    const { state } = freshState();
    place(state, state.players[2]!, "garen", 1);
    place(state, state.players[2]!, "lux", 4);
    ui.showOpponentDetail(state, 2);
    const detail = registry.get("detail")!;
    expect(byText(detail, "对手上回合阵容")).not.toBeNull();
    expect(byText(detail, "玩家 2")).not.toBeNull();
    expect(byText(detail, "战力")).not.toBeNull();
    expect(detail.querySelectorAll(".lineup-cell")).toHaveLength(6);
    expect(byText(detail, "盖伦")).not.toBeNull();
  });

  it("对手匹配面板展示双方阵容预览与战力", async () => {
    const ui = await import("../web/ui");
    const { state } = freshState();
    place(state, state.players[0]!, "garen", 1);
    place(state, state.players[1]!, "jinx", 4);
    ui.showPrepareOverlay({ opponentId: 1, amFirst: true }, () => undefined, state);
    const overlay = registry.get("overlay")!;
    expect(byText(overlay, "对手：玩家 1")).not.toBeNull();
    expect(byText(overlay, "我方阵容")).not.toBeNull();
    expect(byText(overlay, "对手阵容")).not.toBeNull();
    expect(overlay.querySelectorAll(".lineup-cell")).toHaveLength(12); // 双方各 6 格
    expect(byText(overlay, "开战 ▶")).not.toBeNull();
  });

  it("开始界面渲染战绩与开始匹配按钮，点击触发回调", async () => {
    const ui = await import("../web/ui");
    let started = false;
    ui.showStartScreen({ bestRank: 3, played: 12 }, { onMatch: () => (started = true) });
    const start = registry.get("start")!;
    expect(start.classList.contains("hidden")).toBe(false);
    expect(byText(start, "英雄战棋")).not.toBeNull();
    expect(byText(start, "最好名次 第 3 名")).not.toBeNull();
    expect(byText(start, "12 局")).not.toBeNull();
    byText(start, "⚔ 开始匹配")!.fire("click");
    expect(started).toBe(true);
    expect(start.classList.contains("hidden")).toBe(true);
  });

  it("匹配选图：3 张地图、可选图投票、倒计时结束回传结果", async () => {
    vi.useFakeTimers();
    const ui = await import("../web/ui");
    const votes: string[] = [];
    let finished: string | null = null;
    const screen = ui.showMatchScreen(3, {
      onVote: (id) => votes.push(id),
      onFinish: (picked) => (finished = picked),
    });
    const match = registry.get("match")!;
    const cards = match.querySelectorAll(".map-card");
    expect(cards).toHaveLength(3);
    expect(byText(match, "交战选图")).not.toBeNull();
    expect(byText(match, "召唤师峡谷")).not.toBeNull();
    expect(byText(match, "嚎哭深渊")).not.toBeNull();
    expect(byText(match, "祖安地下城")).not.toBeNull();

    screen.update({
      secondsLeft: 2,
      picked: null,
      tally: { summoners_rift: 3, howling_abyss: 2, zaun_undercity: 1 },
      revealedVotes: ["summoners_rift", "summoners_rift", "summoners_rift", "howling_abyss", "howling_abyss", "zaun_undercity", null, null],
      winner: null,
    });
    expect(byText(match, "3")).not.toBeNull();
    // 本局阵容：已投票的格子会亮起
    expect(match.querySelectorAll(".roster-cell")).toHaveLength(8);
    expect(match.querySelectorAll(".roster-cell.voted")).toHaveLength(6);

    cards[1]!.fire("click");
    expect(votes).toEqual(["howling_abyss"]);
    expect(cards[1]!.classList.contains("picked")).toBe(true);

    await vi.advanceTimersByTimeAsync(3200);
    expect(finished).toBe("howling_abyss");
    screen.close();
    expect(match.classList.contains("hidden")).toBe(true);
    vi.useRealTimers();
  });

  it("战力估算随上阵提升", async () => {
    const ui = await import("../web/ui");
    const { state } = freshState();
    const p = state.players[0]!;
    const before = ui.boardPower(p);
    place(state, p, "viego", 1);
    expect(ui.boardPower(p)).toBeGreaterThan(before);
  });
});
