# 部署到 GitHub Pages

前端是纯静态产物（`vite build` → `dist/`，58 个文件 / 1.7 MB），任何静态托管都能放。
这份文档走 **GitHub Pages + GitHub Actions**：推代码就自动构建发布。

---

## ✅ 已经部署好了

| | |
|---|---|
| 线上地址 | **https://adv1346288207.github.io/lol-autobattler/** |
| 仓库 | https://github.com/adv1346288207/lol-autobattler （public） |
| 分支 | `master` |
| 流水线 | push → 取素材 → 校验 → 测试 → 构建 → 发布 Pages |

**以后只要 `git push` 就会自动重新发布**，不用做别的。

### 踩过的坑：Pages 站点要手动开一次

工作流里的 `actions/configure-pages@v5` 带 `enablement: true`，
但 **`GITHUB_TOKEN` 没有创建 Pages 站点的权限**，第一次会失败：

```
X Create Pages site failed. Error: Resource not accessible by integration
```

用 OAuth token 手动开一次就好（只需一次）：

```powershell
gh api -X POST repos/<用户名>/<仓库名>/pages -f build_type=workflow
```

之后再跑就一路绿了。

---

## 为什么不能放 Supabase

实测过：Supabase Storage 把 HTML 当普通文本返回，浏览器不会渲染。

```
HTTP/1.1 200 OK
Content-Type: text/plain          ← 不是 text/html
X-Content-Type-Options: nosniff   ← 禁止浏览器猜类型
```

所以 Storage 只能放图片/JSON 这类资源，**不能当网页托管**。
Supabase 留给后端用（登录、名次榜、云存档），前端另找静态托管。

---

## 一次性准备

### 1. 登录 gh

```powershell
gh auth login          # 选 GitHub.com → HTTPS → 浏览器登录
gh auth status         # 确认已登录
```

### 2. 建仓库并推上去

```powershell
cd D:\Codex_app
gh repo create lol-autobattler --public --source=. --remote=origin --push
```

- `--public`：**免费账号的 Pages 只能用于公开仓库**；有 GitHub Pro 的话可以换 `--private`。
- 仓库里只有代码，**没有 Riot 的立绘素材**（那些被 `.gitignore` 排除，构建时现拉），
  所以公开仓库不涉及素材版权外传。

### 3. 打开 Pages

工作流里已经带了 `actions/configure-pages` 的 `enablement: true`，一般会自动开。
如果没开，手动设一次：**Settings → Pages → Source 选 “GitHub Actions”**。

---

## 之后每次发布

```powershell
git add -A
git commit -m "你的改动"
git push
```

推上去后 Actions 会自动：

1. `npm ci`
2. `npm run assets:lol` —— 从 Riot Data Dragon 现拉 20 立绘 + 20 头像 + 13 武器图标
3. `npm run assets:check` —— 数量不对就直接失败，**不会把"没图版"发上线**
4. `npm test` —— 282 个测试全过才继续
5. `npm run web:build`
6. 发布到 Pages

地址：`https://<你的用户名>.github.io/lol-autobattler/`

也可以在仓库的 **Actions → Deploy to GitHub Pages → Run workflow** 手动触发。

---

## 为什么构建产物放在 `/lol-autobattler/` 子路径也能用

`vite.config.ts` 里 `base` 默认是 `"./"`（相对路径），
`web/ui.ts` 的 `assetUrl()` 会把 config 里的 `/assets/lol/...` 补上 `import.meta.env.BASE_URL`。

想固定成绝对子路径：

```powershell
$env:BASE_PATH="/my-repo/"; npm run web:build
```

### 本地验证子路径部署

```powershell
npm run web:build
npm run serve:dist          # http://localhost:4191/lol-autobattler/
npm run play -- --port 4191 --path lol-autobattler --rounds 3
```

### 直接测线上站点

```powershell
npm run play -- --url https://adv1346288207.github.io/lol-autobattler --rounds 3
```

两条都会用 Playwright 走完整流程，**任何 4xx/5xx 都会被报出来**，
所以它们能证明子路径下立绘、头像、武器图标全都加载成功。

---

## 换别的托管

同一份 `dist/` 直接拖过去就行，因为 `base` 是相对路径：

| 平台 | 方式 |
|---|---|
| Cloudflare Pages | 构建命令 `npm run web:build`，输出目录 `dist`，**需要加一步取素材**（Build command 改成 `npm run assets:lol && npm run web:build`） |
| Netlify / Vercel | 同上 |
| 自己的服务器 | 把 `dist/` 丢进任意 Web 根目录 |
| 局域网给手机试玩 | `npm run web`（已监听 0.0.0.0），手机开 `http://<电脑IP>:5173` |
| 临时公网给朋友看 | `ngrok http 5173`（`allowedHosts` 已配好 ngrok 全域） |
