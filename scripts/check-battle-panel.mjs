/**
 * 战斗面板尺寸自检：直接进战斗，量 .battle-root 是否铺满游戏区。
 * 之前把 --aspect 改名后 .battle-root 的 min() 失效，面板会挤成中间一小坨。
 *   node scripts/check-battle-panel.mjs --url http://localhost:4192/lol-autobattler
 */
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const argOf = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const URL = argOf("url", "http://localhost:4192/lol-autobattler");
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].find((p) => p);

const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ["--hide-scrollbars"] });
const page = await browser.newPage({ viewport: { width: 393, height: 873 }, deviceScaleFactor: 2 });
const problems = [];
page.on("pageerror", (e) => problems.push(String(e.message)));

// battle=1 会直接播放一场战斗
await page.goto(`${URL}/?seed=21&skip=3&battle=1`, { waitUntil: "networkidle" });
await page.waitForSelector(".battle-root", { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(900);

const m = await page.evaluate(() => {
  const phone = document.getElementById("phone");
  const root = document.querySelector(".battle-root");
  const grid = document.querySelector(".battle-grid");
  const cell = document.querySelector(".battle-cell");
  if (!phone || !root) return null;
  const p = phone.getBoundingClientRect();
  const r = root.getBoundingClientRect();
  return {
    phone: { w: Math.round(p.width), h: Math.round(p.height) },
    root: { w: Math.round(r.width), h: Math.round(r.height) },
    cells: document.querySelectorAll(".battle-cell").length,
    units: document.querySelectorAll(".battle-unit").length,
    gridW: grid ? Math.round(grid.getBoundingClientRect().width) : 0,
    cellW: cell ? Math.round(cell.getBoundingClientRect().width) : 0,
    overflow: root.scrollWidth - root.clientWidth,
  };
});

await page.screenshot({ path: "shots/check-battle-panel.png" });
await browser.close();

if (!m) {
  console.log("❌ 没有渲染出 .battle-root（战斗面板没打开）");
  process.exit(1);
}
const wRatio = m.root.w / m.phone.w;
console.log(`游戏区 ${m.phone.w}×${m.phone.h}`);
console.log(`战斗面板 ${m.root.w}×${m.root.h}   占游戏区宽度 ${(wRatio * 100).toFixed(0)}%`);
console.log(`格子 ${m.cells} 个，单位 ${m.units} 个，单格宽 ${m.cellW}px，内部溢出 ${m.overflow}`);
const ok = wRatio > 0.85 && m.overflow <= 1 && m.cellW > 40 && m.cells === 12;
console.log(ok ? "✅ 战斗面板铺满且格子正常" : "❌ 战斗面板尺寸异常（可能又是 CSS 变量失效）");
for (const p of problems) console.log("  pageerror: " + p);
process.exit(ok && problems.length === 0 ? 0 : 1);
