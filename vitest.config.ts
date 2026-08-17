import { defineConfig } from "vitest/config";

// vitest 独立配置：不共用 vite.config.ts（vite 的 root:"web" 会影响测试发现）
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
