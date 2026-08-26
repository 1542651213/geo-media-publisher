import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@publisher/domain": resolve(__dirname, "packages/domain/src"),
      "@publisher/db": resolve(__dirname, "packages/db/src"),
      "@publisher/ai": resolve(__dirname, "packages/ai/src"),
      "@publisher/image": resolve(__dirname, "packages/image/src"),
      "@publisher/logger": resolve(__dirname, "packages/logger/src"),
      "@publisher/adapters-core": resolve(__dirname, "packages/adapters/core/src"),
      "@publisher/adapters-manual": resolve(__dirname, "packages/adapters/manual/src"),
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
      "@publisher/adapters-facebook": resolve(__dirname, "packages/adapters/facebook/src"),
      "@publisher/adapters-weibo": resolve(__dirname, "packages/adapters/weibo/src"),
      "@publisher/adapters-baijiahao": resolve(__dirname, "packages/adapters/baijiahao/src"),
      "@publisher/adapters-zhihu": resolve(__dirname, "packages/adapters/zhihu/src"),
      "@publisher/adapters-sohu-media": resolve(__dirname, "packages/adapters/sohu-media/src"),
      "@publisher/adapters-wechat-channels": resolve(__dirname, "packages/adapters/wechat-channels/src"),
      "@publisher/adapters-xiaohongshu": resolve(__dirname, "packages/adapters/xiaohongshu/src"),
      "@publisher/adapters-qq-public": resolve(__dirname, "packages/adapters/qq-public/src")
      ,"@publisher/adapters-lieju": resolve(__dirname, "packages/adapters/lieju/src")
      ,"@publisher/adapters-cnblogs": resolve(__dirname, "packages/adapters/cnblogs/src")
    }
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "packages/**/*.test.ts"],
    reporters: ["default"]
  }
});
