import { describe, expect, it, vi } from "vitest";
import { ApplicationShutdownCoordinator, type ApplicationShutdownEvent } from "../apps/desktop/src/main/application-shutdown";

function eventStub(): { event: { preventDefault: () => void }; prevented: () => number } {
  let count = 0;
  return { event: { preventDefault: () => { count += 1; } }, prevented: () => count };
}

describe("ApplicationShutdownCoordinator", () => {
  it("stops resources in order and allows the second quit event to exit", async () => {
    const calls: string[] = [];
    const events: ApplicationShutdownEvent[] = [];
    const coordinator = new ApplicationShutdownCoordinator({
      stopSchedulers: () => { calls.push("scheduler"); },
      closeBrowserSessions: async () => { calls.push("browser"); },
      closeDatabase: () => { calls.push("db"); },
      onEvent: (event) => events.push(event)
    });
    const first = eventStub();
    let quitCalls = 0;
    coordinator.handleBeforeQuit(first.event, () => { quitCalls += 1; });
    coordinator.handleBeforeQuit(first.event, () => { quitCalls += 1; });
    await coordinator.waitForCleanup();
    expect(first.prevented()).toBe(2);
    expect(calls).toEqual(["scheduler", "browser", "db"]);
    expect(coordinator.getState()).toBe("CLEANUP_COMPLETE");
    expect(quitCalls).toBe(1);
    coordinator.handleBeforeQuit(first.event, () => { quitCalls += 1; });
    expect(coordinator.getState()).toBe("EXITING");
    expect(quitCalls).toBe(1);
    expect(events).toEqual(expect.arrayContaining(["SCHEDULERS_STOP_STARTED", "SCHEDULERS_STOP_COMPLETED", "BROWSER_SESSIONS_CLOSE_STARTED", "BROWSER_SESSIONS_CLOSE_COMPLETED", "DB_CLOSE_STARTED", "DB_CLOSE_COMPLETED", "APP_EXIT_CALLED"]));
  });

  it("continues cleanup after a failed stage and runs each stage once", async () => {
    const calls: string[] = [];
    const errors: ApplicationShutdownEvent[] = [];
    const coordinator = new ApplicationShutdownCoordinator({
      stopSchedulers: () => { calls.push("scheduler"); throw new Error("scheduler failed"); },
      closeBrowserSessions: () => { calls.push("browser"); throw new Error("browser failed"); },
      closeDatabase: () => { calls.push("db"); },
      onError: (stage) => errors.push(stage)
    });
    const first = eventStub();
    coordinator.handleBeforeQuit(first.event, vi.fn());
    coordinator.handleBeforeQuit(first.event, vi.fn());
    await coordinator.waitForCleanup();
    expect(calls).toEqual(["scheduler", "browser", "db"]);
    expect(errors).toEqual(["SCHEDULERS_STOP_STARTED", "BROWSER_SESSIONS_CLOSE_STARTED"]);
  });

  it("handles a window that is already destroyed and a second shutdown request", async () => {
    const coordinator = new ApplicationShutdownCoordinator({ stopSchedulers: vi.fn(), closeBrowserSessions: vi.fn() });
    coordinator.record("WINDOW_CLOSE_REQUESTED");
    coordinator.record("WINDOW_DESTROYED");
    const first = eventStub();
    coordinator.handleBeforeQuit(first.event, vi.fn());
    coordinator.handleBeforeQuit(first.event, vi.fn());
    await coordinator.waitForCleanup();
    expect(coordinator.getState()).toBe("CLEANUP_COMPLETE");
  });

  it("bounds a hung browser close without blocking the quit transition", async () => {
    const coordinator = new ApplicationShutdownCoordinator({
      stopSchedulers: vi.fn(),
      closeBrowserSessions: () => new Promise<void>(() => undefined),
      timeoutMs: 5
    });
    const first = eventStub();
    coordinator.handleBeforeQuit(first.event, vi.fn());
    await coordinator.waitForCleanup();
    expect(coordinator.getState()).toBe("CLEANUP_COMPLETE");
  });
});
