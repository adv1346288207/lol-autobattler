/// <reference types="vite/client" />

/**
 * 让 `import.meta.env.BASE_URL`（部署子路径时用）在 tsc 下也有类型。
 * 运行时由 Vite 注入；vitest 同样提供，所以 web/ui.ts 在测试里也能安全读取。
 */
