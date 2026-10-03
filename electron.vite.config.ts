import { resolve } from "node:path";
import { execFileSync } from 'node:child_process';
import { readFileSync,readdirSync } from 'node:fs';
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const sourceCommit=execFileSync('git',['-c',`safe.directory=${__dirname.replaceAll('\\','/')}`,'rev-parse','HEAD'],{cwd:__dirname,encoding:'utf8'}).trim();
if(!/^[a-f0-9]{40}$/u.test(sourceCommit))throw new Error('BUILD_SOURCE_COMMIT_REQUIRED');
const identity={appVersion:(JSON.parse(readFileSync(resolve(__dirname,'package.json'),'utf8')) as {version:string}).version,deliveryId:'R1.15-H.2',sourceCommit,builtAt:new Date().toISOString(),migrations:readdirSync(resolve(__dirname,'packages/db/migrations')).filter(name=>name.endsWith('.sql')).sort()};
const define={__GEO_BUILD_IDENTITY__:JSON.stringify(identity)};
export default defineConfig({
  main: {
    define,
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { main: resolve(__dirname, "apps/desktop/src/main/main.ts"), 'closed-snapshot-worker': resolve(__dirname, 'apps/desktop/src/main/closed-snapshot-worker.ts') }, output: { entryFileNames: chunk => chunk.name === 'main' ? 'main.js' : '[name].cjs', chunkFileNames: 'chunks/[name]-[hash].cjs' }, external: ["playwright-core", "kerberos"] } },
    resolve: {
      alias: {
        "@publisher/domain": resolve(__dirname, "packages/domain/src"),
        "@publisher/db": resolve(__dirname, "packages/db/src"),
        "@publisher/ai": resolve(__dirname, "packages/ai/src"),
        "@publisher/image": resolve(__dirname, "packages/image/src"),
        "@publisher/logger": resolve(__dirname, "packages/logger/src"),
        "@publisher/adapters-core": resolve(__dirname, "packages/adapters/core/src"),
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
    define,
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve(__dirname, "apps/desktop/src/main/preload.ts") } },
    resolve: {
      alias: {
        "@publisher/domain": resolve(__dirname, "packages/domain/src")
      }
    }
  },
  renderer: {
    define,
    plugins: [react()],
    resolve: {
      alias: {
        "@publisher/domain": resolve(__dirname, "packages/domain/src")
      }
    }
  }
});
