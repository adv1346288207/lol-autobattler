/**
 * 极简静态服务器：把构建产物挂在**子路径**下，用来验证 GitHub Pages 那种
 * `https://<user>.github.io/<repo>/` 部署是否真的不 404。
 *
 * 用法：
 *   node scripts/serve-static.mjs --dir dist --prefix /lol-autobattler --port 4191
 *   然后访问 http://localhost:4191/lol-autobattler/
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const DIR = path.resolve(argOf("dir", "dist"));
const PREFIX = argOf("prefix", "").replace(/\/+$/, "");
const PORT = Number(argOf("port", "4191"));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

const server = createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    if (PREFIX && !urlPath.startsWith(PREFIX)) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end(`404 (只服务 ${PREFIX}/ 下的内容)`);
      return;
    }
    urlPath = urlPath.slice(PREFIX.length) || "/";
    if (urlPath.endsWith("/")) urlPath += "index.html";

    const file = path.join(DIR, urlPath);
    if (!file.startsWith(DIR)) {
      res.writeHead(403).end();
      return;
    }
    const info = await stat(file).catch(() => null);
    if (!info || !info.isFile()) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("404 Not Found");
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      "content-length": body.length,
      "cache-control": "no-store",
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end(String(err));
  }
});

server.listen(PORT, () => {
  console.log(`静态服务：http://localhost:${PORT}${PREFIX}/  →  ${DIR}`);
});
