import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("canonical session runtime introspection", () => {
  it("exposes a read-only heartbeat in the main process and preload bridge", () => {
    const ipc = readFileSync(new URL("../apps/desktop/src/main/ipc.ts", import.meta.url), "utf8");
    const preload = readFileSync(new URL("../apps/desktop/src/main/preload.ts", import.meta.url), "utf8");
    const sharedApi = readFileSync(new URL("../apps/desktop/src/shared/api.ts", import.meta.url), "utf8");

    expect(ipc).toContain('register("accounts:session-heartbeat"');
    expect(ipc).toContain("getBrowserRuntimeSnapshot");
    expect(preload).toContain('sessionHeartbeat: (accountId, platformKey, input) => invoke("accounts:session-heartbeat"');
    expect(sharedApi).toContain("sessionHeartbeat(accountId: string, platformKey: string, input?: BrowserSessionHeartbeatInput)");
  });

  it("keeps the heartbeat read-only and free of browser navigation or publish calls", () => {
    const ipc = readFileSync(new URL("../apps/desktop/src/main/ipc.ts", import.meta.url), "utf8");
    const start = ipc.indexOf('register("accounts:session-heartbeat"');
    const end = ipc.indexOf('register("accounts:overview"', start);
    expect(start).toBeGreaterThanOrEqual(0);
    const route = ipc.slice(start, end < 0 ? undefined : end);

    expect(route).not.toContain("checkLogin");
    expect(route).not.toContain("newPage");
    expect(route).not.toContain("navigate");
    expect(route).not.toContain("preparePublish");
    expect(route).not.toContain("repository.create");
  });
});
