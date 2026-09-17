#!/usr/bin/env node
/**
 * Riot Data Dragon 英雄头像下载脚本
 * ── 只依赖 Node 20+ 内置能力（node:fs/promises、node:crypto、内置 fetch、node:path） ──
 *
 * 用法：
 *   node scripts/fetch-lol-assets.mjs                 # 下载 20 张方形头像 + 20 张卡面立绘
 *   node scripts/fetch-lol-assets.mjs --latest        # 先查最新版本并写回清单，再下载
 *   node scripts/fetch-lol-assets.mjs --no-portraits  # 只下方形头像（卡面立绘改用占位）
 *   node scripts/fetch-lol-assets.mjs --splashes      # 额外下载 20 张大尺寸原画（默认不下载）
 *   node scripts/fetch-lol-assets.mjs --spells        # 额外下载技能图标（默认不下载）
 *
 * 设计要点：
 * - 资产固定版本号、固定 zh_CN，避免上游更新导致本地表现漂移。
 * - 先写同目录临时文件 <name>.tmp，校验通过后 rename 原子改名；失败清理临时文件。
 * - 清单记录每个文件的 file / sourceUrl / sha256 / bytes；重复运行时哈希一致则跳过。
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 项目根目录（scripts/ 的上一级） */
export const PROJECT_ROOT = path.resolve(HERE, "..");

/** 资产目录：web/public/assets/lol（vite root 为 web，构建时原样拷贝到 dist） */
export const ASSETS_DIR = path.join(PROJECT_ROOT, "web", "public", "assets", "lol");

/** 清单文件路径 */
export const MANIFEST_PATH = path.join(ASSETS_DIR, "manifest.json");

export const DD_HOST = "https://ddragon.leagueoflegends.com";

/** 默认固定版本（首次运行、清单缺失时使用） */
export const DEFAULT_DATA_DRAGON_VERSION = "16.18.1";

/** 本原型只使用简体中文资源 */
export const LOCALE = "zh_CN";

/** 单请求超时（毫秒） */
export const REQUEST_TIMEOUT_MS = 20000;

/**
 * 20 名英雄的 Riot Data Dragon ID（大小写敏感，必须与 config/cards.ts 的 dataDragonId 一一对应）
 */
export const DATA_DRAGON_IDS = Object.freeze([
  "Garen",
  "Poppy",
  "Lux",
  "JarvanIV",
  "Darius",
  "Draven",
  "Katarina",
  "Swain",
  "Shen",
  "Yasuo",
  "Ahri",
  "Irelia",
  "Vi",
  "Jinx",
  "Caitlyn",
  "Ekko",
  "Hecarim",
  "Kalista",
  "Thresh",
  "Viego",
]);

if (new Set(DATA_DRAGON_IDS).size !== DATA_DRAGON_IDS.length) {
  throw new Error("DATA_DRAGON_IDS 存在重复项，请检查英雄 ID 表");
}

/**
 * 武器卡用到的官方装备图标 ID（与 config/weapons.ts 的 itemId 一一对应）
 * 64×64 PNG，卡面居中展示，正好 1:1 不放大。
 */
export const DATA_DRAGON_ITEM_IDS = Object.freeze([
  "1036", // 长剑
  "1042", // 短剑
  "1029", // 布甲
  "1043", // 反曲之弓
  "1037", // 十字镐
  "1031", // 锁子甲
  "3031", // 无尽之刃
  "3085", // 卢安娜的飓风
  "3075", // 荆棘之甲
  "3153", // 破败王者之刃
  "3026", // 守护天使
  "3089", // 灭世者的死亡之帽
  "3146", // 海克斯科技枪刃（武器万能牌）
]);

if (new Set(DATA_DRAGON_ITEM_IDS).size !== DATA_DRAGON_ITEM_IDS.length) {
  throw new Error("DATA_DRAGON_ITEM_IDS 存在重复项，请检查装备 ID 表");
}

/**
 * 初始清单：assets 为空，真实 sha256/bytes 由下载脚本写入，不手写假值。
 */
export function buildInitialManifest() {
  return {
    dataDragonVersion: DEFAULT_DATA_DRAGON_VERSION,
    locale: LOCALE,
    assets: {},
  };
}

/** 英雄列表接口 URL（用于校验 20 个 ID 全部存在） */
export function championListUrl(version, locale = LOCALE) {
  return `${DD_HOST}/cdn/${version}/data/${locale}/champion.json`;
}

/** 单英雄详情接口 URL（--spells 用） */
export function championDetailUrl(version, id, locale = LOCALE) {
  return `${DD_HOST}/cdn/${version}/data/${locale}/champion/${id}.json`;
}

/** 方形头像 URL */
export function championImageUrl(version, id) {
  return `${DD_HOST}/cdn/${version}/img/champion/${id}.png`;
}

/** 加载图（皮肤 0）URL */
export function championSplashUrl(version, id) {
  return `${DD_HOST}/cdn/${version}/img/champion/splash/${id}_0.jpg`;
}

/**
 * 卡面立绘（loading 图，308×560 竖版、纯色背景）URL
 * 这是 Data Dragon 里最接近"卡牌立绘"的官方资源：人物居中、背景干净。
 * 注意：loading / centered 这两类资源不受版本号约束，带版本号反而 403，
 * 所以这里固定用 /cdn/img/... 路径；分辨率 308×560 正好覆盖卡面 3 倍屏。
 */
export function championPortraitUrl(version, id) {
  void version; // 保留参数以统一调用签名，实际 URL 不含版本号
  return `${DD_HOST}/cdn/img/champion/loading/${id}_0.jpg`;
}

/** 技能图标 URL */
export function spellImageUrl(version, imageFull) {
  return `${DD_HOST}/cdn/${version}/img/spell/${imageFull}`;
}

/** 装备（武器卡）图标 URL */
export function itemImageUrl(version, itemId) {
  return `${DD_HOST}/cdn/${version}/img/item/${itemId}.png`;
}

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/** 读取清单；不存在或损坏时回退到初始清单（不抛错，交由调用方决定是否落盘） */
export async function readManifest() {
  if (!existsSync(MANIFEST_PATH)) return buildInitialManifest();
  try {
    const parsed = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
    return {
      dataDragonVersion: parsed?.dataDragonVersion ?? DEFAULT_DATA_DRAGON_VERSION,
      locale: parsed?.locale ?? LOCALE,
      assets: parsed?.assets && typeof parsed.assets === "object" ? parsed.assets : {},
    };
  } catch (err) {
    console.warn(`[warn] manifest.json 解析失败，将按初始清单重建：${err.message}`);
    return buildInitialManifest();
  }
}

export async function writeManifest(manifest) {
  await mkdir(ASSETS_DIR, { recursive: true });
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

/** 按 file 字段排序后重写清单，保证多次运行产出稳定顺序 */
async function flushManifest(manifest) {
  const sorted = {};
  for (const key of Object.keys(manifest.assets).sort()) {
    sorted[key] = manifest.assets[key];
  }
  manifest.assets = sorted;
  await writeManifest(manifest);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 带超时的 GET，失败自动重试（网络抖动容错）。
 * 返回 { ok, status, contentType, buffer }；网络层异常直接抛出。
 */
async function fetchWithRetry(url, { retries = 2, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: "*/*" },
      });
      const buffer = Buffer.from(await res.arrayBuffer());
      return {
        ok: res.ok,
        status: res.status,
        contentType: res.headers.get("content-type") ?? "",
        buffer,
      };
    } catch (err) {
      lastError = err;
      if (attempt < retries) await sleep(400 * (attempt + 1));
    }
  }
  throw new Error(`请求失败 ${url}：${lastError?.message ?? lastError}`);
}

/** 响应校验：HTTP 状态、content-type、非零字节长度 */
function assertResponse(res, url, { expectImage }) {
  if (!res.ok) throw new Error(`HTTP ${res.status}（${url}）`);
  if (expectImage && !res.contentType.toLowerCase().startsWith("image/")) {
    throw new Error(`content-type 不是图片：${res.contentType || "(空)"}（${url}）`);
  }
  if (res.buffer.byteLength === 0) throw new Error(`响应体为 0 字节（${url}）`);
}

/**
 * 取远端资源并写入磁盘（原子改名）。
 * 返回 { status: "written" | "skipped", bytes, sha256 }。
 */
async function downloadAsset({ url, relativeFile, manifest, counters }) {
  const res = await fetchWithRetry(url);
  assertResponse(res, url, { expectImage: true });

  const digest = sha256(res.buffer);
  const record = manifest.assets[relativeFile];

  // 清单与本地文件都一致时跳过重写；本地文件被删/被改则重下
  if (record?.sha256 === digest) {
    const abs = path.join(ASSETS_DIR, relativeFile);
    if (existsSync(abs) && sha256(await readFile(abs)) === digest) {
      counters.skipped += 1;
      console.log(`[跳过] ${relativeFile}（sha256 一致）`);
      return { status: "skipped", bytes: res.buffer.byteLength, sha256: digest };
    }
  }

  const abs = path.join(ASSETS_DIR, relativeFile);
  const tmp = `${abs}.tmp`;
  await mkdir(path.dirname(abs), { recursive: true });
  try {
    await writeFile(tmp, res.buffer);
    await rename(tmp, abs);
  } catch (err) {
    // 任何失败都不得留下临时文件
    await rm(tmp, { force: true }).catch(() => {});
    throw new Error(`写入 ${relativeFile} 失败：${err.message}`);
  }

  manifest.assets[relativeFile] = {
    file: relativeFile,
    sourceUrl: url,
    sha256: digest,
    bytes: res.buffer.byteLength,
  };
  counters.downloaded += 1;
  console.log(`[下载] ${relativeFile}（${res.buffer.byteLength} 字节）`);
  return { status: "written", bytes: res.buffer.byteLength, sha256: digest };
}

/** 查询 Data Dragon 最新版本号（versions.json 第一项） */
async function fetchLatestVersion() {
  const url = `${DD_HOST}/api/versions.json`;
  const res = await fetchWithRetry(url, { retries: 1 });
  if (!res.ok) throw new Error(`HTTP ${res.status}（${url}）`);
  const versions = JSON.parse(res.buffer.toString("utf8"));
  if (!Array.isArray(versions) || typeof versions[0] !== "string") {
    throw new Error(`${url} 返回格式异常`);
  }
  return versions[0];
}

/** 校验 20 个 Data Dragon ID 在 champion.json 中全部存在 */
async function assertChampionsExist(version, locale) {
  const url = championListUrl(version, locale);
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}（${url}）`);
  let payload;
  try {
    payload = JSON.parse(res.buffer.toString("utf8"));
  } catch (err) {
    throw new Error(`${url} 不是合法 JSON：${err.message}`);
  }
  const data = payload?.data;
  if (!data || typeof data !== "object") throw new Error(`${url} 缺少 data 字段`);

  const missing = DATA_DRAGON_IDS.filter((id) => !(id in data));
  if (missing.length > 0) {
    throw new Error(`Data Dragon ${version} 缺少英雄：${missing.join(", ")}`);
  }
  return { url, count: DATA_DRAGON_IDS.length };
}

/** 解析单英雄技能图标文件名（best-effort；拿不到只跳过，不算失败） */
async function collectSpellImages(version, id, locale) {
  const url = championDetailUrl(version, id, locale);
  try {
    const res = await fetchWithRetry(url, { retries: 1 });
    if (!res.ok) return { url, images: [], error: `HTTP ${res.status}` };
    const payload = JSON.parse(res.buffer.toString("utf8"));
    const spells = payload?.data?.[id]?.spells;
    if (!Array.isArray(spells)) return { url, images: [], error: "spells 字段缺失" };
    const images = spells
      .map((spell) => spell?.image?.full)
      .filter((full) => typeof full === "string" && full.length > 0);
    return { url, images, error: null };
  } catch (err) {
    return { url, images: [], error: err.message };
  }
}

function parseArgs(argv) {
  return {
    latest: argv.includes("--latest"),
    // 卡面立绘默认下载（UI 的卡牌正面就是它）；--no-portraits 可跳过
    portraits: !argv.includes("--no-portraits"),
    // 武器卡图标默认下载；--no-items 可跳过
    items: !argv.includes("--no-items"),
    splashes: argv.includes("--splashes"),
    spells: argv.includes("--spells"),
  };
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const counters = { downloaded: 0, skipped: 0, failed: 0 };
  const failures = [];

  const manifest = await readManifest();
  let version = manifest.dataDragonVersion;
  console.log(`[信息] 清单版本：${version}，locale：${manifest.locale}`);

  if (!existsSync(MANIFEST_PATH)) {
    await writeManifest(manifest);
    console.log(`[信息] 已创建初始清单 ${path.relative(PROJECT_ROOT, MANIFEST_PATH)}`);
  }

  // 1) 只有显式 --latest 才联查询最新版本并写回清单
  if (flags.latest) {
    try {
      const latest = await fetchLatestVersion();
      if (latest !== version) {
        version = latest;
        manifest.dataDragonVersion = latest;
        await flushManifest(manifest);
        console.log(`[信息] 已更新清单版本号 -> ${latest}`);
      } else {
        console.log(`[信息] 已是最新版本 ${latest}`);
      }
    } catch (err) {
      console.error(`[错误] 获取最新版本失败：${err.message}`);
      process.exitCode = 1;
      return;
    }
  }

  // 2) 校验 20 个英雄 ID 全部存在
  try {
    const { url } = await assertChampionsExist(version, manifest.locale);
    console.log(`[信息] 英雄列表校验通过（${url}）`);
  } catch (err) {
    console.error(`[错误] 英雄列表校验失败：${err.message}`);
    process.exitCode = 1;
    return;
  }

  // 3) 方形头像（默认唯一必下项）
  for (const id of DATA_DRAGON_IDS) {
    const relativeFile = `champions/${id}.png`;
    try {
      await downloadAsset({
        url: championImageUrl(version, id),
        relativeFile,
        manifest,
        counters,
      });
    } catch (err) {
      counters.failed += 1;
      failures.push(`${relativeFile}：${err.message}`);
      console.error(`[失败] ${relativeFile}：${err.message}`);
    }
  }

  // 4) 卡面立绘（loading 图）：UI 卡牌正面用，默认下载
  if (flags.portraits) {
    for (const id of DATA_DRAGON_IDS) {
      const relativeFile = `portraits/${id}.jpg`;
      try {
        await downloadAsset({
          url: championPortraitUrl(version, id),
          relativeFile,
          manifest,
          counters,
        });
      } catch (err) {
        counters.failed += 1;
        failures.push(`${relativeFile}：${err.message}`);
        console.error(`[失败] ${relativeFile}：${err.message}`);
      }
    }
  }

  // 4c) 武器卡图标（装备图标），默认下载
  if (flags.items !== false) {
    for (const itemId of DATA_DRAGON_ITEM_IDS) {
      const relativeFile = `items/${itemId}.png`;
      try {
        await downloadAsset({
          url: itemImageUrl(version, itemId),
          relativeFile,
          manifest,
          counters,
        });
      } catch (err) {
        counters.failed += 1;
        failures.push(`${relativeFile}：${err.message}`);
        console.error(`[失败] ${relativeFile}：${err.message}`);
      }
    }
  }

  // 4b) 可选：大尺寸原画
  if (flags.splashes) {
    for (const id of DATA_DRAGON_IDS) {
      const relativeFile = `splashes/${id}_0.jpg`;
      try {
        await downloadAsset({
          url: championSplashUrl(version, id),
          relativeFile,
          manifest,
          counters,
        });
      } catch (err) {
        counters.failed += 1;
        failures.push(`${relativeFile}：${err.message}`);
        console.error(`[失败] ${relativeFile}：${err.message}`);
      }
    }
  }

  // 5) 可选：技能图标（同一 URL 只下一次）
  const spellTasks = new Map();
  if (flags.spells) {
    for (const id of DATA_DRAGON_IDS) {
      const { url, images, error } = await collectSpellImages(version, id, manifest.locale);
      if (error) console.warn(`[警告] 读取 ${id} 技能列表失败（跳过）：${error}（${url}）`);
      for (const image of images) {
        const relativeFile = `spells/${image}`;
        if (!spellTasks.has(relativeFile)) spellTasks.set(relativeFile, spellImageUrl(version, image));
      }
    }
    for (const [relativeFile, url] of spellTasks) {
      try {
        await downloadAsset({ url, relativeFile, manifest, counters });
      } catch (err) {
        counters.failed += 1;
        failures.push(`${relativeFile}：${err.message}`);
        console.error(`[失败] ${relativeFile}：${err.message}`);
      }
    }
  }

  // 6) 落盘清单
  try {
    await flushManifest(manifest);
  } catch (err) {
    console.error(`[错误] 写入清单失败：${err.message}`);
    process.exitCode = 1;
  }

  // 7) 汇总
  console.log("");
  console.log("──────── Riot Data Dragon 资产下载汇总 ────────");
  console.log(`版本号    ：${version}（locale ${manifest.locale}）`);
  console.log(`成功      ：${counters.downloaded}`);
  console.log(`跳过      ：${counters.skipped}`);
  console.log(`失败      ：${counters.failed}`);
  console.log(`清单条目  ：${Object.keys(manifest.assets).length}`);
  if (failures.length > 0) {
    console.log(`失败明细  ：`);
    for (const item of failures) console.log(`  - ${item}`);
  }
  console.log(`清单路径  ：${path.relative(PROJECT_ROOT, MANIFEST_PATH)}`);
  console.log("───────────────────────────────────────────────");

  if (counters.failed > 0) {
    // 保留已有合法文件，仅以非零退出码提示需要重试
    process.exitCode = 1;
  }
}

// 仅当作为主模块直接运行时才执行下载，被 vitest 导入时保持纯函数
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`[错误] 未捕获异常：${err?.stack ?? err}`);
    process.exitCode = 1;
  });
}
