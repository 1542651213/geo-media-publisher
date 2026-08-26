import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CredentialDecryptError, SafeStorageCredentialStore } from "@publisher/security";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("SafeStorageCredentialStore", () => {
  it("persists encrypted values and exposes only configured status", () => {
    const dir = mkdtempSync(join(tmpdir(), "publisher-security-")); dirs.push(dir);
    const fake = { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(`encrypted:${value}`), decryptString: (value: Buffer) => value.toString().replace(/^encrypted:/u, "") };
    const path = join(dir, "credentials.enc");
    const store = new SafeStorageCredentialStore(path, fake);
    store.set("ai:apiKey", "secret-value");
    expect(store.has("ai:apiKey")).toBe(true);
    expect(store.getStatus?.("ai:apiKey")).toBe("Configured");
    expect(store.get("ai:apiKey")).toBe("secret-value");
    expect(store.get("missing")).toBeNull();
    expect(store.getStatus?.("missing")).toBe("NotConfigured");
  });

  it("does not report corrupted ciphertext as configured", () => {
    const dir = mkdtempSync(join(tmpdir(), "publisher-security-corrupt-")); dirs.push(dir);
    const path = join(dir, "credentials.enc");
    const working = { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() };
    new SafeStorageCredentialStore(path, working).set("account:a:token", "stored");
    const broken = new SafeStorageCredentialStore(path, { ...working, decryptString: () => { throw new Error("Windows identity changed"); } });
    expect(broken.has("account:a:token")).toBe(false);
    expect(broken.getStatus?.("account:a:token")).toBe("DecryptFailed");
    expect(() => broken.get("account:a:token")).toThrow(CredentialDecryptError);
  });
});
