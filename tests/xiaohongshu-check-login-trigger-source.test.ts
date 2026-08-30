import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("account check-login trigger source", () => {
  it("uses CHECK_LOGIN for the account-center check-login IPC route", () => {
    const source = readFileSync(join(process.cwd(), "apps", "desktop", "src", "main", "ipc.ts"), "utf8");
    const route = source.slice(source.indexOf('register("accounts:check-login"'));
    expect(route).toContain('createUserAction("CHECK_LOGIN")');
    expect(route).not.toContain('createUserAction("RUN_SELF_TEST")');
  });

  it("keeps RUN_SELF_TEST reserved for the platform self-test runner", () => {
    const source = readFileSync(join(process.cwd(), "apps", "desktop", "src", "main", "platform-self-test.ts"), "utf8");
    expect(source).toContain('triggerSource: "RUN_SELF_TEST"');
  });
});
