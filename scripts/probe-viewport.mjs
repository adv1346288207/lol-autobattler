/**
 * 自适应分辨率探针：在多种屏幕尺寸下量 #phone / #app 的实际尺寸，并检查有没有溢出裁切。
 *
 *   npm run web:build && npm run serve:dist
 *   node scripts/probe-viewport.mjs --url http://localhost:4191/lol-autobattler
 */
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const argOf = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const URL = argOf("url", "http://localhost:4191/lol-autobattler");

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].find((p) => p);

const CASES = [
  { name: "老机型 16:9", w: 360, h: 640 },
  { name: "iPhoneSE 16:9", w: 375, h: 667 },
  { name: "iPhone15 19.5:9", w: 393, h: 852 },
  { name: "参考图 20:9", w: 432, h: 960 },
  { name: "大屏 20:9", w: 430, h: 932 },
  { name: "Xperia 21:9", w: 412, h: 960 },
  { name: "竖屏平板", w: 800, h: 1280 },
  { name: "横屏平板", w: 1280, h: 800 },
  { name: "笔记本", w: 1440, h: 900 },
];

const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ["--hide-scrollbars"] });
let bad = 0;

console.log("屏幕            视口        游戏区       宽高比  占屏面积  溢出   （自适应）");
console.log("─".repeat(74));

for (const c of CASES) {
  const page = await browser.newPage({ viewport: { width: c.w, height: c.h }, deviceScaleFactor: 1 });
  await page.goto(`${URL}/?quick=1&skip=2&noequip=1`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const m = await page.evaluate(() => {
    const phone = document.getElementById("phone");
    const app = document.getElementById("app");
    if (!phone || !app) return null;
    const p = phone.getBoundingClientRect();
    // 有没有内容被挤出去：app 的滚动尺寸 vs 可视尺寸
    const overflowX = app.scrollWidth - app.clientWidth;
    const overflowY = app.scrollHeight - app.clientHeight;
    // 关键元素是否都在视口内
    const keys = ["#shoppanel", "#arena", "#bottom", "#opps", "#traits", "#tb-left"];
    const out = keys.filter((sel) => {
      const el = document.querySelector(sel);
      if (!el) return true;
      const r = el.getBoundingClientRect();
      return r.width < 8 || r.height < 8 || r.right > p.right + 1 || r.bottom > p.bottom + 1;
    });
    return { pw: p.width, ph: p.height, overflowX, overflowY, out };
  });
  if (!m) {
    console.log(`${c.name} 读取失败`);
    bad++;
    await page.close();
    continue;
  }
  const area = ((m.pw * m.ph) / (c.w * c.h)) * 100;
  const ratio = (m.pw / m.ph).toFixed(3);
  const over = m.overflowX > 1 || m.overflowY > 1 ? `X ${m.overflowX}/${m.overflowY}` : "无";
  const badKeys = m.out.length ? `  缺/超界: ${m.out.join(",")}` : "";
  // 阈值放宽到 280：窄屏手机可能出现更窄的游戏区，那不是 bug
  const flag = m.pw < 280 || m.overflowX > 1 || m.overflowY > 1 || m.out.length ? " ❌" : "";
  if (flag) bad++;
  console.log(
    `${c.name.padEnd(12)} ${`${c.w}×${c.h}`.padEnd(11)} ${`${Math.round(m.pw)}×${Math.round(m.ph)}`.padEnd(12)} ${ratio}   ${area.toFixed(0).padStart(3)}%     ${over}${badKeys}${flag}`,
  );
  await page.close();
}

await browser.close();
console.log("─".repeat(74));
console.log(bad === 0 ? "✅ 所有尺寸都正常" : `❌ ${bad} 个尺寸有问题`);
process.exit(bad === 0 ? 0 : 1);
