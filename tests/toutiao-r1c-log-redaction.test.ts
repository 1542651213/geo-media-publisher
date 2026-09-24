import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFileLogger, sanitizeText, sanitizeValue, type Logger } from "@publisher/logger";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("Toutiao auth and signing log redaction", () => {
  it("redacts nested structured keys, text headers and query parameters", () => {
    const nested = { auth: { cookieMaterial: [{ value: "cookie-secret" }], "x-secsdk-csrf-token": "csrf-secret", csrfToken: "csrf-alias-secret", "tt-anti-token": "anti-secret", anti_token: "anti-alias-secret", msToken: "ms-secret", ms_token: "ms-alias-secret", a_bogus: "abogus-secret", aBogus: "abogus-alias-secret", signature: "signature-secret", setCookie: "set-cookie-secret" },
      credentialBundleVersion: 7, loginGeneration: 3 };
    const sanitized = JSON.stringify(sanitizeValue(nested));
    for (const secret of ["cookie-secret", "csrf-secret", "csrf-alias-secret", "anti-secret", "anti-alias-secret", "ms-secret", "ms-alias-secret", "abogus-secret", "abogus-alias-secret", "signature-secret", "set-cookie-secret"]) expect(sanitized).not.toContain(secret);
    expect(sanitized).toContain("credentialBundleVersion");
    const text = sanitizeText("Authorization=Bearer auth-secret Cookie=session=cookie-secret; other=hidden msToken=ms-secret a_bogus=abogus-secret");
    for (const secret of ["auth-secret", "cookie-secret", "ms-secret", "abogus-secret"]) expect(text).not.toContain(secret);
    expect(sanitizeText("https://example.invalid/?tt-anti-token=anti-secret&msToken=ms-secret")).not.toContain("anti-secret");
  });

  it("writes only redacted auth material to the file logger", async () => {
    const dir = mkdtempSync(join(tmpdir(), "toutiao-logger-")); dirs.push(dir);
    const path = join(dir, "app.log");
    const noOp: Logger = { info() {}, warn() {}, error() {} };
    createFileLogger(path, noOp).info("TOUTIAO_AUTH", "MOCK", "tt-anti-token=anti-secret", { response: { msToken: "ms-secret", signature: "signature-secret" } });
    await vi.waitFor(() => expect(readFileSync(path, "utf8")).toContain("MOCK"));
    const file = readFileSync(path, "utf8");
    for (const secret of ["anti-secret", "ms-secret", "signature-secret"]) expect(file).not.toContain(secret);
  });
});
