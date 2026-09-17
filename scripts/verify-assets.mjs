/**
 * 校验 Data Dragon 素材是否拉全（CI 与本地都能用）。
 * 素材按 .gitignore 不入库，构建前必须现拉——拉不全就别把"没图版"发上线。
 */
import { readdirSync } from "node:fs";
import path from "node:path";

const ROOT = "web/public/assets/lol";
const REQUIRED = { champions: 20, portraits: 20, items: 13 };

let bad = false;
for (const [dir, min] of Object.entries(REQUIRED)) {
  let n = 0;
  try {
    n = readdirSync(path.join(ROOT, dir)).filter((f) => !f.startsWith(".")).length;
  } catch {
    n = 0;
  }
  const ok = n >= min;
  if (!ok) bad = true;
  console.log(`${ok ? "✅" : "❌"} ${dir}: ${n} / 需要 ${min}`);
}

if (bad) {
  console.error("\n素材不全。本地先跑：npm run assets:lol");
  process.exit(1);
}
console.log("素材齐全");
