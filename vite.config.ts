import { defineConfig } from "vite";

/**
 * 隧道 / 局域网访问白名单。
 *
 * Vite 默认只接受 localhost，用 ngrok 打开会直接返回：
 *   Blocked request. This host ("xxx.ngrok-free.dev") is not allowed.
 * 以 "." 开头的项同时匹配该域名及其所有子域名。
 *
 * 想临时加别的域名，用环境变量即可（不用改文件）：
 *   PowerShell:  $env:VITE_ALLOWED_HOSTS=".mytunnel.com"; npm run web
 *   bash:        VITE_ALLOWED_HOSTS=.mytunnel.com npm run web
 * 想彻底放开（任意域名）：$env:VITE_ALLOWED_HOSTS="*"; npm run web
 */
const TUNNEL_HOSTS = [
  ".ngrok-free.dev",
  ".ngrok-free.app",
  ".ngrok.io",
  ".ngrok.app",
  ".trycloudflare.com",
  ".loca.lt",
  ".serveo.net",
  ".tailscale.net",
  "localhost",
  "127.0.0.1",
];

const extraHosts = (process.env.VITE_ALLOWED_HOSTS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/** 是否允许任意 Host（VITE_ALLOWED_HOSTS="*"） */
const allowAll = extraHosts.includes("*");

const tunnel = {
  /** 监听 0.0.0.0：隧道和同局域网手机才连得上 */
  host: true,
  /** 注意：这是给本地开发用的便利设置，别把带这个配置的服务暴露到公网长期运行 */
  allowedHosts: (allowAll ? true : [...TUNNEL_HOSTS, ...extraHosts]) as string[] | true,
};

export default defineConfig({
  /**
   * 部署子路径：默认 "./"（相对路径），这样同一份构建产物放在
   * 根域、GitHub Pages 的 /<repo>/、还是任意子目录都能直接用。
   * 要固定成绝对子路径就设 BASE_PATH：
   *   $env:BASE_PATH="/lol-autobattler/"; npm run web:build
   */
  base: process.env.BASE_PATH || "./",
  root: "web",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    ...tunnel,
  },
  // npm run web:preview 走的是 preview 服务器，它同样做 Host 校验
  preview: {
    port: 4173,
    ...tunnel,
  },
});
