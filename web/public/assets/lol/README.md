# LoL 英雄资源（Riot Data Dragon）

> ⚠️ **非官方声明**
>
> 本项目是**本地、个人、非商业的粉丝试玩原型**，用于学习自动战斗卡牌玩法与前端渲染，
> **未获 Riot Games 背书、赞助或授权**。LoL、League of Legends、Riot Games 及相关英雄名称、
> 称号、图标、立绘与其它资产均为其各自权利人的商标或版权财产。
>
> 本目录下的二进制资源仅在本机开发调试时通过官方公开 CDN 拉取，**不提交进 Git**。
> 在**公开发布、分发或任何形式的商业化**之前，必须先重新核对 Riot 的开发者政策与法务页面
> （Riot Developer Policy、Riot Legal / Terms of Service、以及面向第三方产品的资产使用条款），
> 确认当前用法是否被允许；若不被允许，需替换为原创素材或取得正式授权。

## 资产来源

- 提供方：**Riot Games Data Dragon**（英雄联盟官方静态资源 CDN）
- 基础地址：`https://ddragon.leagueoflegends.com`
- 使用接口：
  - 版本列表 `GET /api/versions.json`
  - 英雄列表 `GET /cdn/{version}/data/{locale}/champion.json`
  - 单英雄详情 `GET /cdn/{version}/data/{locale}/champion/{Id}.json`
  - 方形头像 `GET /cdn/{version}/img/champion/{Id}.png`（120×120，回退用）
  - **卡面立绘** `GET /cdn/img/champion/loading/{Id}_0.jpg`（308×560 竖版，UI 卡牌正面）
  - 大尺寸原画 `GET /cdn/img/champion/splash/{Id}_0.jpg`（可选）
  - 技能图标 `GET /cdn/{version}/img/spell/{file}`（可选）

> 注意：`loading` / `splash` 这两类资源**不受版本号约束**，路径里带版本号会返回 403，
> 因此脚本对它们固定使用 `/cdn/img/...`；只有 `champion.json` 与方形头像走固定版本号。

## 固定版本与语言

- **版本固定**：默认使用 `manifest.json` 里的 `dataDragonVersion`（当前 `16.18.1`）。
  固定版本可以避免上游更新导致本地头像/名称与代码配置漂移，保证同 seed 复现表现一致。
- **语言固定**：`locale` 为 `zh_CN`（简体中文），与原型 UI 文案一致。
- 只有显式传入 `--latest` 时才会请求 `versions.json` 并取第一项写回清单。

## 重新下载

```bash
npm run assets:lol          # 下载 20 张方形头像 + 20 张卡面立绘（UI 实际使用立绘）
npm run assets:lol:latest   # 先查询并写回最新版本号，再下载
```

可选参数：

```bash
node scripts/fetch-lol-assets.mjs --no-portraits      # 只下方形头像（卡面改用首字占位）
node scripts/fetch-lol-assets.mjs --splashes          # 额外下载 20 张大尺寸原画
node scripts/fetch-lol-assets.mjs --spells            # 额外下载技能图标
```

脚本行为约定：

- 只依赖 Node 20+ 内置模块，**不新增任何依赖**。
- 每个响应都校验 HTTP 状态、`content-type`（图片须为 `image/*`）与非零字节长度，超时 20 秒。
- 先写同目录临时文件 `<name>.tmp`，校验通过后 `rename` 原子改名；失败会清理临时文件，不留半张图。
- 重复运行时，若本地文件 SHA-256 与清单一致则跳过（打印「跳过」），不重写文件、不改清单。
- 网络失败时保留已有合法文件，打印清晰错误并以非零退出码结束。
- 结束时打印汇总：成功 / 跳过 / 失败数量与版本号。

## 输出目录

```
web/public/assets/lol/
├── manifest.json          # 清单（跟踪进 Git）
├── README.md              # 本文件（跟踪进 Git）
├── champions/<Id>.png     # 20 张方形头像（忽略，不入库）
├── portraits/<Id>.jpg     # 20 张卡面立绘（忽略，不入库；UI 卡牌正面）
├── splashes/<Id>_0.jpg    # 可选大尺寸原画（忽略，不入库）
└── spells/<file>          # 可选技能图标（忽略，不入库）
```

`web/public` 是 Vite 的静态资源目录（vite root 为 `web`），构建时会原样拷贝到 `dist`。

## UI 中的三级图片回退

卡面渲染按 `portrait → image → 首字占位` 依次回退：
立绘加载失败会自动换成方形头像，头像也失败则显示英雄首字 + 品质渐变色块，
因此**离线或缺图时不会出现破图**，也不阻塞玩法。

## 清单字段含义

`manifest.json` 结构：

```json
{
  "dataDragonVersion": "16.18.1",
  "locale": "zh_CN",
  "assets": {
    "champions/Garen.png": {
      "file": "champions/Garen.png",
      "sourceUrl": "https://ddragon.leagueoflegends.com/cdn/16.18.1/img/champion/Garen.png",
      "sha256": "<64 位十六进制>",
      "bytes": 12345
    },
    "portraits/Garen.jpg": {
      "file": "portraits/Garen.jpg",
      "sourceUrl": "https://ddragon.leagueoflegends.com/cdn/img/champion/loading/Garen_0.jpg",
      "sha256": "<64 位十六进制>",
      "bytes": 45678
    }
  }
}
```

| 字段 | 含义 |
| --- | --- |
| `dataDragonVersion` | 本次下载使用的 Data Dragon 版本号 |
| `locale` | 资源语言，固定 `zh_CN` |
| `assets` | 以**相对 `web/public/assets/lol/` 的路径**为键的条目表 |
| `assets[*].file` | 同上，文件相对路径，例如 `champions/Garen.png` |
| `assets[*].sourceUrl` | 精确来源 URL，便于追溯与重新校验 |
| `assets[*].sha256` | 文件内容 SHA-256，用于跳过重复下载与完整性校验 |
| `assets[*].bytes` | 文件字节数，正整数 |

初始提交的清单 `assets` 为空对象，**不预置任何假的 sha256 或 `bytes: 0`**；
真实哈希与字节数一律由下载脚本在成功写入后填写。

## 为什么二进制资源不提交进 Git

- **版权与许可**：这些美术资产的权利属于 Riot Games，不适合随源码仓库分发；
  仓库里只保留「来源 + 版本 + 哈希」的清单，等价于一份可复现的下载配方。
- **体积**：PNG/JPG 属于大体积二进制，反复提交会持续膨胀仓库历史且难以清理
  （20 张立绘约 1 MB，20 张大尺寸原画可达数 MB）。
- **可复现**：清单里的 `dataDragonVersion` + `sha256` 足以让任何人按需重新拉到同一份内容，
  并校验下载结果是否被篡改或损坏。

因此 `.gitignore` 忽略 `champions/*.png`、`portraits/*.jpg`、`splashes/`、`spells/`，
而 `manifest.json` 与 `README.md` 保持可跟踪。
