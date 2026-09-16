import { join } from "node:path";
import { _electron as electron } from "playwright-core";

const executablePath = join(process.cwd(), "node_modules", "electron", "dist", "electron.exe");
const accountId = process.env.V114_ZHIHU_ACCOUNT_ID ?? "8f666025-1776-41d5-8295-3bab150f615c";
const electronApp = await electron.launch({
  executablePath,
  args: [process.cwd()],
  env: { ...process.env, PUBLISHER_ENV: "production", PUBLISHER_DATA_MODE: "production" },
  timeout: 30_000
});

try {
  const page = await electronApp.firstWindow({ timeout: 30_000 });
  await page.getByRole("heading", { name: "首页", exact: true }).waitFor({ timeout: 30_000 });
  const background = process.env.V114_ZHIHU_BACKGROUND === "1";
  const run = await page.evaluate(async ({ platformAccountId, backgroundMode }) => backgroundMode
    ? window.publisherAPI.platformSelfTest.runSafe(platformAccountId)
    : window.publisherAPI.platformSelfTest.runLevel(platformAccountId, "L3_CONTENT_FILL"), { platformAccountId: accountId, backgroundMode: background });
  console.log(`V114_ZHIHU_DIAGNOSTIC=${JSON.stringify(run)}`);
} finally {
  await electronApp.close();
}
