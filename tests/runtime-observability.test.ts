import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { Logger } from "@publisher/logger";
import { recordAppStartup, recordRuntimeHeartbeat } from "../apps/desktop/src/main/runtime-observability";

function fakeLogger(): Logger & { info: ReturnType<typeof vi.fn> } {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe("runtime observability", () => {
  it("records a safe packaged app startup marker", () => {
    const logger = fakeLogger();

    recordAppStartup(logger, {
      pid: 9348,
      packaged: true,
      userDataPath: "C:\\Users\\Administrator\\AppData\\Roaming\\codex-media-publisher",
      productionDataPath: "C:\\Users\\Administrator\\AppData\\Roaming\\codex-media-publisher\\production-data",
      appLogPath: "C:\\Users\\Administrator\\AppData\\Roaming\\codex-media-publisher\\production-data\\logs\\app.log"
    });

    expect(logger.info).toHaveBeenCalledWith("APP", "APP_STARTUP", expect.any(String), {
      pid: 9348,
      packaged: true,
      userDataPath: "C:\\Users\\Administrator\\AppData\\Roaming\\codex-media-publisher",
      productionDataPath: "C:\\Users\\Administrator\\AppData\\Roaming\\codex-media-publisher\\production-data",
      appLogPath: "C:\\Users\\Administrator\\AppData\\Roaming\\codex-media-publisher\\production-data\\logs\\app.log"
    });
  });

  it("records a read-only runtime heartbeat without browser or publish data", () => {
    const logger = fakeLogger();

    recordRuntimeHeartbeat(logger, "dashboard:get");

    expect(logger.info).toHaveBeenCalledWith("APP", "RUNTIME_HEARTBEAT", expect.any(String), {
      action: "dashboard:get"
    });
  });

  it("hooks the heartbeat to the default read-only accounts list route", () => {
    const source = readFileSync(new URL("../apps/desktop/src/main/ipc.ts", import.meta.url), "utf8");

    expect(source).toMatch(/register\("accounts:list", \(\) => \{ recordRuntimeHeartbeat\(logger, "accounts:list"\);/u);
  });
});
