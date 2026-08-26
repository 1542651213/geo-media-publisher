import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@publisher/adapters-core": resolve(__dirname, "../core/src"),
      "@publisher/domain": resolve(__dirname, "../../domain/src"),
      "@publisher/security": resolve(__dirname, "../../security/src")
    }
  },
  test: { include: ["src/**/*.test.ts"] }
});
