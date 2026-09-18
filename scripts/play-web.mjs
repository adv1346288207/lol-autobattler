/**
 * 自走自检脚本：用 Playwright 驱动真实浏览器**自己玩一局**，逐步截图 + 收集运行时报错。
 *
 * 用法：
 *   npm run web:build
 *   npm run web:preview -- --port 4188          # 另开一个后台服务
 *   node scripts/play-web.mjs --port 4188 --rounds 3 --out shots
 *
 * 参数：
 *   --port   静态服务端口（默认 4188）
 *   --rounds 自动游玩回合数（默认 3）
 *   --out    截图输出目录（默认 shots）
 *   --seed   固定随机种子（默认随 URL 不带）
 *   --head   显示浏览器窗口（调试用）
 *
 * 它做的事：开始界面 → 开始匹配 → 地图投票 → 每回合【买卡→上阵→装备→准备→开战→继续】→ 截图
 * 任何 console error / pageerror 都会被记下来并让脚本以非零码退出（用来当回归门禁）。
 */
import { chromium } from "playwright-core";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const PORT = argOf("port", "4188");
const ROUNDS = Number(argOf("rounds", "3"));
const OUT = path.resolve(argOf("out", "shots"));
const SEED = argOf("seed", "");
const HEADLESS = !args.includes("--head");
// --path 用来模拟子路径部署（GitHub Pages 的 /<repo>/）
// --url  直接测一个完整地址（例如线上 Pages），不用起本地服务
const SUBPATH = argOf("path", "").replace(/^\/+|\/+$/g, "");
const EXPLICIT_URL = argOf("url", "").replace(/\/+$/, "");
const BASE = EXPLICIT_URL
  ? `${EXPLICIT_URL}/${SEED ? `?seed=${SEED}` : ""}`
  : `http://localhost:${PORT}/${SUBPATH ? `${SUBPATH}/` : ""}${SEED ? `?seed=${SEED}` : ""}`;

const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];

const problems = [];
let shotIndex = 0;

function shot(page, name) {
  shotIndex += 1;
  const file = path.join(OUT, `${String(shotIndex).padStart(2, "0")}-${name}.png`);
  return page.screenshot({ path: file }).then(() => file);
}

/** 拖动一张卡到目标位置（超过 10px 阈值才算拖动） */
async function dragTo(page, fromSelector, toSelector, nth = 0) {
  const from = page.locator(fromSelector).nth(nth);
  const to = page.locator(toSelector).first();
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (!a || !b) throw new Error(`dragTo: 找不到元素 ${fromSelector} -> ${toSelector}`);
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 14, a.y + a.height / 2 + 14, { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(140);
}

async function tap(page, selector, nth = 0) {
  await page.locator(selector).nth(nth).click({ timeout: 5000 });
  await page.waitForTimeout(160);
}

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({
    headless: HEADLESS,
    executablePath: CHROME_CANDIDATES.find((p) => p) /* Chromium 用系统 Chrome */,
    args: ["--hide-scrollbars", "--disable-gpu"],
  });
  const context = await browser.newContext({
    viewport: { width: 393, height: 873 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();

  // 捕获未处理的 Promise 拒绝（播放层出错会走这里，而不是 pageerror）
  await page.addInitScript(() => {
    window.__rejections = [];
    window.addEventListener("unhandledrejection", (e) => {
      window.__rejections.push(String((e.reason && e.reason.stack) || e.reason));
    });
  });

  page.on("console", (msg) => {
    if (msg.type() === "error") problems.push(`[console.error] ${msg.text()}`);
  });
  page.on("pageerror", (err) => problems.push(`[pageerror] ${err.message}`));
  page.on("requestfailed", (req) => {
    const url = req.url();
    if (url.endsWith("/favicon.ico")) return; // 浏览器自动请求，忽略
    problems.push(`[requestfailed] ${url} · ${req.failure()?.errorText ?? ""}`);
  });
  page.on("response", (res) => {
    const url = res.url();
    if (res.status() >= 400 && !url.endsWith("/favicon.ico")) {
      problems.push(`[http ${res.status()}] ${url}`);
    }
  });

  const steps = [];
  const log = (s) => {
    steps.push(s);
    console.log("· " + s);
  };

  log(`访问地址：${BASE}`);
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await shot(page, "start");
  log(`开始界面已加载，标题=${await page.locator("#start .start-title").textContent()}`);

  /* ── 自检 1：首页打开图鉴 → 点角色 → 详情必须真的弹在最上层 ── */
  await tap(page, "#start .start-mini .btn", 0); // 【图鉴】
  await page.waitForTimeout(300);
  const codexOpen = await page.locator("#codex .codex-cell").count();
  log(`图鉴打开：${codexOpen} 张卡`);
  if (codexOpen > 0) {
    await shot(page, "codex");
    await page.locator("#codex .codex-cell").first().click();
    await page.waitForTimeout(350);
    await shot(page, "codex-card-detail");
    const cover = await page.evaluate(() => {
      const d = document.getElementById("detail");
      if (!d || d.classList.contains("hidden")) return "详情没打开";
      const name = d.querySelector(".detail-name");
      if (!name) return "详情里没有名字";
      const r = name.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      if (!top) return "命中了空处";
      return d.contains(top) ? "ok" : `被 ${top.className || top.id} 盖住了`;
    });
    if (cover === "ok") log("  ✅ 图鉴里点角色能看到详情（层级正确）");
    else problems.push(`[图鉴详情被遮挡] ${cover}`);
    await page.locator("#detail .panel-close").click().catch(() => {});
    await page.locator("#codex .codex-close").click().catch(() => {});
    await page.waitForTimeout(200);
  } else {
    problems.push("[图鉴] 首页点【图鉴】没有渲染出卡片");
  }

  /* ── 自检 1b：图鉴页签切换（角色 / 武器） ── */
  await tap(page, "#start .start-mini .btn", 0);
  await page.waitForTimeout(250);
  await page.locator("#codex .codex-tab").nth(2).click(); // 【武器】
  await page.waitForTimeout(200);
  const weaponCells = await page.locator("#codex .codex-cell").count();
  await page.locator("#codex .codex-tab").nth(1).click(); // 【角色】
  await page.waitForTimeout(200);
  const heroCells = await page.locator("#codex .codex-cell").count();
  if (weaponCells === 13 && heroCells === 21) log(`  ✅ 图鉴页签：武器 ${weaponCells} 张 / 角色 ${heroCells} 张`);
  else problems.push(`[图鉴页签] 武器 ${weaponCells} 张（应 13）、角色 ${heroCells} 张（应 21）`);
  await page.locator("#codex .codex-close").click().catch(() => {});
  await page.waitForTimeout(200);

  // 开始匹配
  await tap(page, "#start .btn-gold");
  await page.waitForTimeout(300);
  await shot(page, "match");
  log("进入匹配选图");

  // 选一张地图（点第 2 张）
  const mapCount = await page.locator("#match .map-card").count();
  log(`地图数=${mapCount}`);
  await tap(page, "#match .map-card", 1);
  await shot(page, "match-voted");
  // 等倒计时结束（最多 8s）进入对局
  await page.waitForSelector("#start.hidden", { timeout: 12_000 }).catch(() => {});
  await page.waitForFunction(() => document.getElementById("match")?.classList.contains("hidden"), null, {
    timeout: 15_000,
  });
  await page.waitForTimeout(400);
  await shot(page, "game-start");
  log("对局开始");

  /* ── 自检：开局赠礼（1 绿英雄上阵 + 1 绿武器在库）与初始金币 ── */
  {
    const board = await page.locator("#board .board-slot .card").count();
    const bag = await page.locator("#hand .bench-weapon").count();
    const gold = await page.evaluate(() =>
      Number((document.querySelector("#tb-left .tb-gold span:last-child")?.textContent ?? "0").replace(/\D/g, "")),
    );
    if (board === 1 && bag === 1) log(`  ✅ 开局赠礼：棋盘 ${board} 个英雄、仓库 ${bag} 件武器`);
    else problems.push(`[开局赠礼] 棋盘英雄 ${board}（应 1）、仓库武器 ${bag}（应 1）`);
    if (gold === 2) log(`  ✅ 初始金币 ${gold}`);
    else problems.push(`[初始金币] 显示 ${gold}，应为 2`);
  }

  for (let round = 1; round <= ROUNDS; round++) {
    // 自检 0：准备按钮被禁用时，必须已经弹出终局面板——否则就是卡死
    if (await page.locator("#ready").isDisabled()) {
      const finalShown = await page.locator("#overlay .final-list").count();
      if (finalShown > 0) {
        await shot(page, "final");
        log("对局结束（出现终局名次面板）");
      } else {
        await shot(page, "soft-lock");
        problems.push(`[卡死] 第 ${round} 回合：准备按钮被禁用，但既没结束也没有终局面板`);
      }
      break;
    }
    const roundNo = await page.locator("#ready .ready-num").textContent();
    log(`—— 第 ${round} 回合（界面显示 ${roundNo}）——`);

    // 1) 买 + 上阵：把商店卡依次拖到棋盘槽（武器会自动进武器库）
    for (let i = 0; i < 3; i++) {
      const card = page.locator("#shop .shop-slot .card").nth(0);
      if ((await card.count()) === 0) break;
      const disabled = await card.evaluate((el) => el.classList.contains("disabled"));
      if (disabled) continue;
      const empty = await page.locator("#board .board-slot").evaluateAll((slots) =>
        slots.findIndex((s) => !s.querySelector(".card")),
      );
      const before = await page.locator("#shop .shop-slot .card").count();
      if (empty >= 0) await dragTo(page, "#shop .shop-slot .card", `#board .board-slot >> nth=${empty}`, 0);
      const after = await page.locator("#shop .shop-slot .card").count();
      log(`  买卡：商店卡 ${before} → ${after}，棋盘空位 ${empty}`);
      if (after === before) break; // 买不动了
    }
    const bag = await page.locator("#hand .bench-weapon").count();
    const handN = await page.locator("#hand .card").count();
    log(`  仓库：英雄 ${handN} 张 / 武器 ${bag} 件`);
    await shot(page, `r${round}-after-buy`);

    // 2) 把仓库里的武器拖到英雄身上
    if (bag > 0) {
      const heroSlots = await page.locator("#board .board-slot .card").count();
      if (heroSlots > 0) {
        await dragTo(page, "#hand .bench-weapon", "#board .board-slot .card", 0);
        const left = await page.locator("#hand .bench-weapon").count();
        log(`  装备武器：仓库 ${bag} → ${left} 件，棋盘武器条 ${await page.locator("#board .card-weapon.has-weapon").count()} 个`);
      }
    }
    const benchDump = await page.evaluate(() => {
      const h = document.getElementById("hand");
      return { kids: h.children.length, text: (h.textContent || "").slice(0, 40) };
    });
    log(`  仓库 DOM：${benchDump.kids} 个子节点 · "${benchDump.text}"`);

    // 自检：拖武器时必须出现"跟着手走"的拖拽幽灵（和拖卡牌一样）
    const weaponChip = page.locator("#hand .bench-weapon").first();
    if (await weaponChip.isVisible().catch(() => false)) {
      const box = await weaponChip.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 26, box.y + box.height / 2 + 26, { steps: 4 });
      const ghosts = await page.locator(".drag-ghost").count();
      const ghostBox = ghosts ? await page.locator(".drag-ghost").first().boundingBox() : null;
      const zoneText = await page.locator("#sellzone").textContent().catch(() => null);
      if (ghosts > 0) await shot(page, `r${round}-weapon-drag-ghost`);
      // 移到商店上方：出售区应点亮
      const shopBox = await page.locator("#shoppanel").boundingBox();
      // 停在下半部分截图：字在上方，这样截图能同时看到遮罩和文字
      await page.mouse.move(shopBox.x + shopBox.width / 2, shopBox.y + shopBox.height * 0.72, { steps: 5 });
      const zoneOnShop = await page
        .locator("#sellzone")
        .evaluate((el) => el.classList.contains("active"))
        .catch(() => false);
      if (zoneOnShop && ghosts > 0) await shot(page, `r${round}-sell-zone`);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 });
      await page.mouse.up();
      await page.waitForTimeout(150);
      if (ghosts > 0 && ghostBox && ghostBox.width > 4 && ghostBox.height > 4) {
        log(`  ✅ 拖武器有拖拽幽灵（${Math.round(ghostBox.width)}×${Math.round(ghostBox.height)}）`);
      } else {
        problems.push(`[拖武器无幽灵] 数量=${ghosts}，尺寸=${ghostBox ? `${Math.round(ghostBox.width)}×${Math.round(ghostBox.height)}` : "无"}`);
      }
      if (zoneText && zoneText.includes("出售区")) log(`  ✅ 拖动时显示出售区（${zoneText.replace(/\s+/g, "")}）`);
      else problems.push(`[无出售区] 拖动时 #sellzone 文本=${zoneText}`);
      if (zoneOnShop) log("  ✅ 悬停到商店时出售区点亮");
      else problems.push("[出售区未点亮] 悬停在商店上没有 active 类");
      if ((await page.locator("#sellzone").count()) === 0) log("  ✅ 松手后出售区已移除");
      else problems.push("[出售区残留] 拖拽结束后 #sellzone 还在");
    }

    await shot(page, `r${round}-after-equip`);

    // 3) 打开一张卡看详情（顺便验证弹窗不报错）
    if (round === 1) {
      const firstCard = page.locator("#board .board-slot .card").first();
      if ((await firstCard.count()) > 0) {
        await firstCard.click();
        await page.waitForTimeout(250);
        await shot(page, "card-detail");
        await page.locator("#detail .panel-close").click().catch(() => {});
        await page.waitForTimeout(150);
      }
      // 羁绊详情
      const trait = page.locator("#traits .trait-chip").first();
      if ((await trait.count()) > 0) {
        await trait.click();
        await page.waitForTimeout(250);
        await shot(page, "trait-detail");
        await page.locator("#detail .panel-close").click().catch(() => {});
        await page.waitForTimeout(150);
      }
      // 对手阵容
      const opp = page.locator("#opps .opp").nth(1);
      if ((await opp.count()) > 0) {
        await opp.click();
        await page.waitForTimeout(250);
        await shot(page, "opp-detail");
        await page.locator("#detail .panel-close").click().catch(() => {});
        await page.waitForTimeout(150);
      }
    }

    // 3) 自检 2：从详情里【卸下武器】——必须回到仓库
    if (round === 2 && (await page.locator("#board .card-weapon.has-weapon").count()) > 0) {
      const before = await page.locator("#hand .bench-weapon").count();
      await page.locator("#board .board-slot .card").first().click();
      await page.waitForTimeout(300);
      const off = page.locator("#detail .equip-off");
      if ((await off.count()) > 0) {
        await shot(page, `r${round}-detail-equipped`);
        await off.first().click();
        await page.waitForTimeout(300);
        const after = await page.locator("#hand .bench-weapon").count();
        if (after > before) log(`  ✅ 详情里卸下武器：仓库武器 ${before} → ${after}`);
        else problems.push(`[卸下武器] 仓库武器 ${before}→${after}，没回到仓库`);
      } else {
        await page.locator("#detail .panel-close").click().catch(() => {});
        log("  （这张卡没装备，跳过卸下自检）");
      }
    }

    // 3b) 自检 3：卖掉带装备的英雄——武器必须退回仓库（或折成金币），不能凭空消失
    if (round === 3 && (await page.locator("#board .card-weapon.has-weapon").count()) > 0) {
      const goldOf = () =>
        page.evaluate(() =>
          Number((document.querySelector("#tb-left .tb-gold span:last-child")?.textContent ?? "0").replace(/\D/g, "")),
        );
      const goldBefore = await goldOf();
      const benchBefore = await page.locator("#hand .bench-weapon").count();
      await dragTo(page, "#board .card-weapon.has-weapon", "#shop", 0);
      await page.waitForTimeout(350);
      const goldAfter = await goldOf();
      const benchAfter = await page.locator("#hand .bench-weapon").count();
      await shot(page, `r${round}-after-sell`);
      if (goldAfter > goldBefore || benchAfter > benchBefore) {
        log(`  ✅ 卖带装备的英雄：金币 ${goldBefore}→${goldAfter}，仓库武器 ${benchBefore}→${benchAfter}`);
      } else {
        problems.push(`[卖装备英雄] 金币 ${goldBefore}→${goldAfter}、仓库武器 ${benchBefore}→${benchAfter}，装备被吞了`);
      }
    }

    // 3c) 自检 4：设置面板（含退出到主菜单）
    if (round === 1) {
      await page.locator("#tb-left .tb-btn").first().click();
      await page.waitForTimeout(250);
      const items = await page.locator("#detail .settings-item").count();
      const exitText = await page.locator("#detail .settings-item").first().textContent();
      await shot(page, "settings");
      if (items >= 3 && exitText.includes("退出到主菜单")) log(`  ✅ 设置面板：${items} 项，含「退出到主菜单」`);
      else problems.push(`[设置面板] 只有 ${items} 项 / 首项=${exitText}`);
      await page.locator("#detail .panel-close").click().catch(() => {});
      await page.waitForTimeout(150);
    }

    // 4) 准备 → 开战
    await tap(page, "#ready");
    await page.waitForTimeout(350);
    await shot(page, `r${round}-prepare`);
    const fight = page.locator("#overlay .btn-gold").first();
    // 轮空时不会有开战面板（遮罩是隐藏的），必须看可见性而不是元素数量
    if (await fight.isVisible().catch(() => false)) {
      await fight.first().click();
      await page.waitForTimeout(600);
      await shot(page, `r${round}-battle`);

      // 自检：战斗中点击单位（含对手）能弹出状态面板
      {
        const units = page.locator(".battle-unit.tappable");
        const n = await units.count();
        // 点最后一个：通常是对手那一半
        if (n > 0) {
          await units.nth(n - 1).click();
          await page.waitForTimeout(280);
          const opened = await page.locator("#detail .bu-detail").count();
          const text = opened ? await page.locator("#detail .bu-detail").textContent() : "";
          if (opened > 0) await shot(page, `r${round}-battle-unit-detail`);
          await page.locator("#detail .panel-foot .btn").click().catch(() => {});
          await page.waitForTimeout(150);
          if (opened > 0 && /当前状态|生命|攻击/.test(text)) {
            log(`  ✅ 战斗中点单位弹出状态（${n} 个可点，含对手）`);
          } else {
            problems.push(`[战斗中查看状态] 面板数=${opened}，文本=${(text || "").slice(0, 40)}`);
          }
        } else {
          problems.push("[战斗中查看状态] 没有任何可点的战斗单位");
        }
      }
      // 跳过加速，直接等“继续”
      const skip = page.locator("#overlay .btn", { hasText: "跳过" });
      if (await skip.first().isVisible().catch(() => false)) await skip.first().click().catch(() => {});
      await page.waitForTimeout(900);
      await shot(page, `r${round}-battle-end`);
      const next = page.locator("#overlay .btn-gold", { hasText: "继续" });
      const finalNow = await page.locator("#overlay .final-list").count();
      if (await next.first().isVisible().catch(() => false)) {
        await next.first().click();
        await page.waitForTimeout(400);
      } else if (finalNow > 0) {
        // 这一局把玩家打死了：直接进终局面板，属于正常路径
        log("本回合出局，直接进入终局面板");
      } else {
        problems.push(`第 ${round} 回合：战斗结束后既没有【继续】按钮，也没有终局面板`);
      }
    } else {
      log(`第 ${round} 回合轮空，没有开战面板`);
    }
    await shot(page, `r${round}-next`);

    // 结束时看终局面板
    const finalPanel = await page.locator("#overlay .final-list").count();
    if (finalPanel > 0) {
      await shot(page, "final");
      log("对局结束，出现终局名次面板");
      break;
    }
  }

  const rejections = await page.evaluate(() => window.__rejections ?? []);
  for (const r of rejections) problems.push(`[unhandledrejection] ${r}`);

  const report = [
    "═══ 自走自检报告 ═══",
    `步骤：${steps.length}`,
    ...steps.map((s, i) => `  ${i + 1}. ${s}`),
    `截图：${shotIndex} 张 → ${OUT}`,
    problems.length ? `❌ 运行时报错 ${problems.length} 条：` : "✅ 没有 console error / pageerror",
    ...problems.map((p) => "  - " + p),
  ].join("\n");  writeFileSync(path.join(OUT, "report.txt"), report, "utf8");
  console.log("\n" + report);

  await browser.close();
  process.exit(problems.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("自走脚本崩溃：", err);
  process.exit(2);
});
