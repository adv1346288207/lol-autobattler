/**
 * 资源清单与本地 LoL 头像一致性测试
 * ── 只读校验：不联网、不下载；图片缺失时跳过而不是失败 ──
 * ── scripts/ 不在 tsconfig include 内，这里用 await import() + 本地类型声明接入 ──
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HERO_CARDS } from "../config/cards";

/** 下载脚本导出的纯函数签名（避免为 .mjs 生成类型声明） */
interface LolAssetsModule {
  DATA_DRAGON_IDS: readonly string[];
  DEFAULT_DATA_DRAGON_VERSION: string;
  LOCALE: string;
  championImageUrl(version: string, id: string): string;
  championPortraitUrl(version: string, id: string): string;
  buildInitialManifest(): {
    dataDragonVersion: string;
    locale: string;
    assets: Record<string, unknown>;
  };
}

/** 动态导入：被导入时不应触发任何下载 */
// scripts/ 不在 tsconfig include 内（allowJs 关闭），故 .mjs 无类型声明，这里显式断言为上面的接口
// @ts-ignore -- TS7016: 可运行的 .mjs 脚本刻意不生成 .d.ts
const assets = (await import("../scripts/fetch-lol-assets.mjs")) as unknown as LolAssetsModule;

const PROJECT_ROOT = process.cwd();
const LOL_DIR = path.join(PROJECT_ROOT, "web", "public", "assets", "lol");
const MANIFEST_PATH = path.join(LOL_DIR, "manifest.json");
const CHAMPIONS_DIR = path.join(LOL_DIR, "champions");
const PORTRAITS_DIR = path.join(LOL_DIR, "portraits");
const GITIGNORE_PATH = path.join(PROJECT_ROOT, ".gitignore");

/** PNG 文件魔数：前 8 字节 */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** JPEG 文件魔数：FF D8 FF */
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

interface ManifestEntry {
  file?: unknown;
  sourceUrl?: unknown;
  sha256?: unknown;
  bytes?: unknown;
}

interface Manifest {
  dataDragonVersion?: unknown;
  locale?: unknown;
  assets?: Record<string, ManifestEntry>;
}

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Manifest;

/** 20 名英雄卡的 Data Dragon ID（过滤掉万能牌等无图卡） */
const heroDragonIds = HERO_CARDS.map((card) => card.dataDragonId).filter(
  (id): id is string => typeof id === "string",
);

describe("Data Dragon ID 表与英雄卡池", () => {
  it("导出 20 个 Data Dragon ID，且无重复", () => {
    expect(assets.DATA_DRAGON_IDS).toHaveLength(20);
    expect(new Set(assets.DATA_DRAGON_IDS).size).toBe(20);
  });

  it("与 config/cards.ts 的 HERO_CARDS.dataDragonId 一一对应（集合相等）", () => {
    expect(HERO_CARDS).toHaveLength(20);
    expect(heroDragonIds).toHaveLength(20);
    expect(new Set(heroDragonIds).size).toBe(20);
    expect([...heroDragonIds].sort()).toEqual([...assets.DATA_DRAGON_IDS].sort());
  });

  it("每张英雄卡的 dataDragonId 都出现在导出常量中", () => {
    for (const id of heroDragonIds) {
      expect(assets.DATA_DRAGON_IDS).toContain(id);
    }
  });
});

describe("英雄卡头像路径", () => {
  it("每张英雄卡的 image 都是 /assets/lol/champions/<dataDragonId>.png", () => {
    for (const card of HERO_CARDS) {
      expect(card.image).toBe(`/assets/lol/champions/${card.dataDragonId}.png`);
    }
  });

  it("20 条头像路径互不重复", () => {
    const images = HERO_CARDS.map((card) => card.image);
    expect(images).toHaveLength(20);
    expect(new Set(images).size).toBe(20);
  });

  it("每张英雄卡的 portrait（卡面立绘）都是 /assets/lol/portraits/<dataDragonId>.jpg 且互不重复", () => {
    const portraits = HERO_CARDS.map((card) => {
      expect(card.portrait).toBe(`/assets/lol/portraits/${card.dataDragonId}.jpg`);
      return card.portrait;
    });
    expect(portraits).toHaveLength(20);
    expect(new Set(portraits).size).toBe(20);
  });

  it("没有立绘的卡（英雄复制器）portrait 为 null", () => {
    const dup = HERO_CARDS.find((c) => c.type !== "hero");
    expect(dup).toBeUndefined();
  });
});

describe("championPortraitUrl", () => {
  it("拼接出 Data Dragon 卡面立绘 URL（loading 图不受版本号约束）", () => {
    expect(assets.championPortraitUrl("16.18.1", "Garen")).toBe(
      "https://ddragon.leagueoflegends.com/cdn/img/champion/loading/Garen_0.jpg",
    );
  });

  it("对所有英雄 ID 都是 {cdn}/img/champion/loading/{id}_0.jpg", () => {
    for (const id of assets.DATA_DRAGON_IDS) {
      expect(assets.championPortraitUrl("16.18.1", id)).toBe(
        `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${id}_0.jpg`,
      );
    }
  });
});

describe("championImageUrl", () => {
  it("拼接出 Data Dragon 方形头像 URL", () => {
    const version = assets.DEFAULT_DATA_DRAGON_VERSION;
    expect(assets.championImageUrl(version, "Garen")).toBe(
      `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/Garen.png`,
    );
  });

  it("对所有英雄 ID 都遵循 {cdn}/{version}/img/champion/{id}.png 形式", () => {
    const version = "16.18.1";
    for (const id of assets.DATA_DRAGON_IDS) {
      expect(assets.championImageUrl(version, id)).toBe(
        `https://ddragon.leagueoflegends.com/cdn/16.18.1/img/champion/${id}.png`,
      );
    }
  });
});

describe("初始清单", () => {
  it("buildInitialManifest() 返回固定版本 + zh_CN + 空 assets", () => {
    const initial = assets.buildInitialManifest();
    expect(initial.dataDragonVersion).toBe(assets.DEFAULT_DATA_DRAGON_VERSION);
    expect(initial.locale).toBe(assets.LOCALE);
    expect(initial.assets).toEqual({});
  });

  it("manifest.json 的版本与 locale 字段合法", () => {
    expect(typeof manifest.dataDragonVersion).toBe("string");
    expect(manifest.dataDragonVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.locale).toBe("zh_CN");
    expect(manifest.assets).toBeTypeOf("object");
  });
});

describe("本地已下载图片", () => {
  const presentIds = assets.DATA_DRAGON_IDS.filter((id) =>
    existsSync(path.join(CHAMPIONS_DIR, `${id}.png`)),
  );
  const presentPortraits = assets.DATA_DRAGON_IDS.filter((id) =>
    existsSync(path.join(PORTRAITS_DIR, `${id}.jpg`)),
  );

  it("已存在的头像非空且是 PNG 魔数（缺失则跳过，不联网）", () => {
    if (presentIds.length === 0) {
      // 尚未运行 npm run assets:lol：跳过而不是失败
      expect(presentIds).toHaveLength(0);
      return;
    }
    for (const id of presentIds) {
      const buffer = readFileSync(path.join(CHAMPIONS_DIR, `${id}.png`));
      expect(buffer.byteLength).toBeGreaterThan(0);
      expect(buffer.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
    }
  });

  it("已存在的卡面立绘非空且是 JPEG 魔数（缺失则跳过，不联网）", () => {
    if (presentPortraits.length === 0) {
      expect(presentPortraits).toHaveLength(0);
      return;
    }
    for (const id of presentPortraits) {
      const buffer = readFileSync(path.join(PORTRAITS_DIR, `${id}.jpg`));
      expect(buffer.byteLength).toBeGreaterThan(0);
      expect(buffer.subarray(0, 3).equals(JPEG_MAGIC)).toBe(true);
    }
  });
});

describe("manifest.json 条目完整性", () => {
  const entries = Object.entries(manifest.assets ?? {});

  it("assets 非空时，每项都满足 file/sha256/bytes 约定", () => {
    if (entries.length === 0) {
      // 初始清单就是空 assets，真实哈希由下载脚本写入
      expect(entries).toHaveLength(0);
      return;
    }
    for (const [key, entry] of entries) {
      // file 必须是相对 web/public/assets/lol/ 的路径且与键一致
      expect(entry.file).toBe(key);
      expect(typeof entry.file).toBe("string");
      expect(existsSync(path.join(LOL_DIR, entry.file as string))).toBe(true);
      // sha256 必须是 64 位十六进制
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
      // bytes 必须是正整数
      expect(typeof entry.bytes).toBe("number");
      expect(Number.isInteger(entry.bytes)).toBe(true);
      expect(entry.bytes as number).toBeGreaterThan(0);
      // sourceUrl 必须是官方 Data Dragon 地址
      expect(String(entry.sourceUrl)).toMatch(
        /^https:\/\/ddragon\.leagueoflegends\.com\/cdn\//,
      );
    }
  });

  it("若已下载 20 张头像，则清单包含全部 champions/<Id>.png 条目", () => {
    const downloaded = assets.DATA_DRAGON_IDS.filter((id) =>
      existsSync(path.join(CHAMPIONS_DIR, `${id}.png`)),
    );
    if (downloaded.length === 0) {
      expect(entries).toHaveLength(0);
      return;
    }
    for (const id of downloaded) {
      expect(entries.map(([key]) => key)).toContain(`champions/${id}.png`);
    }
  });

  it("若已下载卡面立绘，则清单包含全部 portraits/<Id>.jpg 条目", () => {
    const downloaded = assets.DATA_DRAGON_IDS.filter((id) =>
      existsSync(path.join(PORTRAITS_DIR, `${id}.jpg`)),
    );
    if (downloaded.length === 0) return;
    for (const id of downloaded) {
      expect(entries.map(([key]) => key)).toContain(`portraits/${id}.jpg`);
    }
  });
});

describe(".gitignore 资源规则", () => {
  const gitignore = readFileSync(GITIGNORE_PATH, "utf8");

  it("champions/portraits/items 已入库（构建自包含），只忽略体积大的 splashes/spells", () => {
    // 策略变更：53 张实际用到的图（约 1.6 MB）随仓库分发，clone 后不联网即可构建。
    expect(gitignore).not.toContain("web/public/assets/lol/champions/*.png");
    expect(gitignore).not.toContain("web/public/assets/lol/portraits/*.jpg");
    expect(gitignore).not.toContain("web/public/assets/lol/items/*.png");
    // 没用到且体积大得多的两类仍然不入库
    expect(gitignore).toContain("web/public/assets/lol/splashes/");
    expect(gitignore).toContain("web/public/assets/lol/spells/");
    expect(gitignore).not.toContain("web/public/assets/lol/manifest.json");
    expect(gitignore).not.toContain("web/public/assets/lol/README.md");
  });

  it("实际用到的图片确实被 git 跟踪（否则 CI 会发出没图的版本）", () => {
    // 光「.gitignore 放开了」不够，得确认真的提交进去了
    const tracked = execFileSync("git", ["ls-files", "web/public/assets/lol"], {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
    })
      .split("\n")
      .filter((l) => /\.(png|jpg)$/.test(l));
    expect(tracked.length).toBeGreaterThanOrEqual(53);
  });
});
