import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve(__dirname, "apps/desktop/src/main/main.ts"), external: ["playwright-core", "kerberos"] } },
    resolve: {
      alias: {
        "@publisher/domain": resolve(__dirname, "packages/domain/src"),
        "@publisher/db": resolve(__dirname, "packages/db/src"),
        "@publisher/ai": resolve(__dirname, "packages/ai/src"),
        "@publisher/image": resolve(__dirname, "packages/image/src"),
        "@publisher/logger": resolve(__dirname, "packages/logger/src"),
        "@publisher/adapters-core": resolve(__dirname, "packages/adapters/core/src"),
        "@publisher/adapters-browser": resolve(__dirname, "packages/adapters/browser/src"),
        "@publisher/adapters-semi-auto": resolve(__dirname, "packages/adapters/semi-auto/src"),
        "@publisher/adapters-test": resolve(__dirname, "packages/adapters/test/src"),
        "@publisher/publisher": resolve(__dirname, "packages/publisher/src"),
        "@publisher/security": resolve(__dirname, "packages/security/src"),
        "@publisher/adapters-wechat": resolve(__dirname, "packages/adapters/wechat/src"),
        "@publisher/adapters-douyin": resolve(__dirname, "packages/adapters/douyin/src"),
        "@publisher/adapters-kuaishou": resolve(__dirname, "packages/adapters/kuaishou/src"),
        "@publisher/adapters-bilibili": resolve(__dirname, "packages/adapters/bilibili/src"),
        "@publisher/adapters-youtube": resolve(__dirname, "packages/adapters/youtube/src"),
        "@publisher/adapters-tiktok": resolve(__dirname, "packages/adapters/tiktok/src"),
        "@publisher/adapters-toutiao": resolve(__dirname, "packages/adapters/toutiao/src"),
        "@publisher/adapters-facebook": resolve(__dirname, "packages/adapters/facebook/src")
        ,"@publisher/adapters-lieju": resolve(__dirname, "packages/adapters/lieju/src")
        ,"@publisher/adapters-cnblogs": resolve(__dirname, "packages/adapters/cnblogs/src")
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve(__dirname, "apps/desktop/src/main/preload.ts") } },
    resolve: {
      alias: {
        "@publisher/domain": resolve(__dirname, "packages/domain/src")
      }
    }
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: {
        "@publisher/domain": resolve(__dirname, "packages/domain/src")
      }
    }
  }
});
