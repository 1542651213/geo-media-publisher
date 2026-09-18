import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProcessDiagnostics, redactDiagnosticText } from "../apps/desktop/src/main/process-diagnostics";

const tempDirs: string[] = [];
afterEach(() => { for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("main process diagnostics", () => {
  it("redacts secret-shaped values before writing an error", () => {
    expect(redactDiagnosticText("token=abc cookie=xyz session: hidden Bearer abc.def")).toBe("token=[REDACTED] cookie=[REDACTED] session: [REDACTED] Bearer [REDACTED]");
  });

  it("writes the error and stdio state to a local file without using console", () => {
    const dir = mkdtempSync(join(tmpdir(), "publisher-diagnostics-")); tempDirs.push(dir);
    const path = join(dir, "main-process-diagnostics.log");
    const diagnostics = createProcessDiagnostics(path, {
      pid: 1234,
      ppid: 5678,
      stdout: { writable: false, destroyed: true },
      stderr: { writable: true, destroyed: false }
    });

    diagnostics.record("IPC_HANDLER_ERROR", { channel: "accounts:overview", error: new Error("token=do-not-write") });

    const entry = JSON.parse(readFileSync(path, "utf8").trim()) as { event: string; error: { name: string; message: string }; stdio: { stdout: { writable: boolean; destroyed: boolean } } };
    expect(entry.event).toBe("IPC_HANDLER_ERROR");
    expect(entry.error).toMatchObject({ name: "Error", message: "token=[REDACTED]" });
    expect(entry.stdio.stdout).toEqual({ writable: false, destroyed: true });
  });
});
