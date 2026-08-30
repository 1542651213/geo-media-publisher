import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { BrowserSessionHeartbeatInput } from "../apps/desktop/src/shared/api";
import { createSessionHeartbeatController, type HeartbeatScheduler } from "../apps/desktop/src/renderer/session-heartbeat";

describe("automatic canonical session heartbeat wiring", () => {
  const makeHarness = () => {
    const calls: Array<{ callback: () => void; delay: number; cancelled: boolean }> = [];
    const scheduler: HeartbeatScheduler = {
      setTimeout: (callback, delay) => {
        const entry = { callback, delay, cancelled: false };
        calls.push(entry);
        return entry;
      },
      clearTimeout: (handle) => { handle.cancelled = true; },
    };
    const sessionHeartbeat = vi.fn(async (_accountId: string, _platformKey: string, _input: BrowserSessionHeartbeatInput) => ({}));
    const controller = createSessionHeartbeatController({ sessionHeartbeat }, scheduler);
    return { calls, sessionHeartbeat, controller };
  };

  it("records immediate login heartbeat and exactly one exact-account survival heartbeat", async () => {
    const { calls, sessionHeartbeat, controller } = makeHarness();

    controller.startPostLogin("account-a", "xiaohongshu");
    await Promise.resolve();

    expect(sessionHeartbeat).toHaveBeenCalledWith("account-a", "xiaohongshu", expect.objectContaining({ phase: "POST_LOGIN_IMMEDIATE", loginGeneration: 1 }));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.delay).toBe(10_000);

    calls[0]?.callback();
    await Promise.resolve();
    expect(sessionHeartbeat).toHaveBeenCalledWith("account-a", "xiaohongshu", expect.objectContaining({ phase: "POST_LOGIN_SURVIVAL", loginGeneration: 1 }));
    expect(sessionHeartbeat).toHaveBeenCalledTimes(2);
  });

  it("invalidates an older survival timer without attributing it to a newer login", async () => {
    const { calls, sessionHeartbeat, controller } = makeHarness();

    controller.startPostLogin("account-a", "xiaohongshu");
    controller.startPostLogin("account-a", "xiaohongshu");
    await Promise.resolve();

    expect(calls).toHaveLength(2);
    expect(calls[0]?.cancelled).toBe(true);
    calls[0]?.callback();
    await Promise.resolve();
    expect(sessionHeartbeat).not.toHaveBeenCalledWith("account-a", "xiaohongshu", expect.objectContaining({ phase: "POST_LOGIN_SURVIVAL", loginGeneration: 1 }));

    calls[1]?.callback();
    await Promise.resolve();
    expect(sessionHeartbeat).toHaveBeenCalledWith("account-a", "xiaohongshu", expect.objectContaining({ phase: "POST_LOGIN_SURVIVAL", loginGeneration: 2 }));
  });

  it("binds survival heartbeats to their original account identity", async () => {
    const { calls, sessionHeartbeat, controller } = makeHarness();

    controller.startPostLogin("account-a", "xiaohongshu");
    controller.startPostLogin("account-b", "xiaohongshu");
    await Promise.resolve();
    calls.forEach((entry) => entry.callback());
    await Promise.resolve();

    expect(sessionHeartbeat).toHaveBeenCalledWith("account-a", "xiaohongshu", expect.objectContaining({ phase: "POST_LOGIN_SURVIVAL" }));
    expect(sessionHeartbeat).toHaveBeenCalledWith("account-b", "xiaohongshu", expect.objectContaining({ phase: "POST_LOGIN_SURVIVAL" }));
  });

  it("records pre/post check heartbeats while executing checkLogin exactly once", async () => {
    const { sessionHeartbeat, controller } = makeHarness();
    const checkLogin = vi.fn(async () => ({ loginStatus: "logged_in" as const }));

    const result = await controller.runCheckLogin("account-a", "xiaohongshu", checkLogin);

    expect(result).toEqual({ loginStatus: "logged_in" });
    expect(checkLogin).toHaveBeenCalledTimes(1);
    expect(sessionHeartbeat.mock.calls.map(([, , input]) => input.phase)).toEqual(["PRE_CHECK_LOGIN", "POST_CHECK_LOGIN"]);
  });

  it("does not duplicate checkLogin when heartbeat invocation fails", async () => {
    const { sessionHeartbeat, controller } = makeHarness();
    sessionHeartbeat.mockRejectedValue(new Error("diagnostics unavailable"));
    const checkLogin = vi.fn(async () => ({ loginStatus: "logged_in" as const }));

    await expect(controller.runCheckLogin("account-a", "xiaohongshu", checkLogin)).resolves.toEqual({ loginStatus: "logged_in" });
    expect(checkLogin).toHaveBeenCalledTimes(1);
    expect(sessionHeartbeat).toHaveBeenCalledTimes(2);
  });

  it("records pre/post gate heartbeats while executing the gate exactly once", async () => {
    const { sessionHeartbeat, controller } = makeHarness();
    const gate = vi.fn(async () => ({ status: "ready" as const }));

    await expect(controller.runPreSubmitGate("account-a", "xiaohongshu", gate)).resolves.toEqual({ status: "ready" });
    expect(gate).toHaveBeenCalledTimes(1);
    expect(sessionHeartbeat.mock.calls.map(([, , input]) => input.phase)).toEqual(["PRE_SUBMIT_GATE_PRECHECK", "POST_SUBMIT_GATE"]);
  });

  it("wires both account-center login and check-login actions to the controller", () => {
    const app = readFileSync(new URL("../apps/desktop/src/renderer/App.tsx", import.meta.url), "utf8");
    const workspace = readFileSync(new URL("../apps/desktop/src/renderer/V11Workspace.tsx", import.meta.url), "utf8");

    expect(app).toContain("beginPostLoginHeartbeat(account.id, account.platformKey)");
    expect(app).toContain("runCheckLoginWithHeartbeats(account.id, account.platformKey");
    expect(workspace).toContain("beginPostLoginHeartbeat(pendingLogin.accountId, pendingLogin.platformKey)");
    expect(workspace).toContain("runCheckLoginWithHeartbeats(row.account.id, row.account.platformKey");
    expect(workspace).toContain("runPreSubmitGateWithHeartbeats(row.account.id, row.account.platformKey");
    expect(workspace).toContain("accounts.inspectPublishEditor(row.account.id, row.account.platformKey)");
  });
});
