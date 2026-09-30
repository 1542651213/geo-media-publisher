import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface CredentialStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  setMany?(values: Readonly<Record<string, string>>): void;
  delete(key: string): void;
  has(key: string): boolean;
  getStatus?(key: string): CredentialStatus;
}

export const CREDENTIAL_STATUSES = ["NotConfigured", "Configured", "DecryptFailed", "Validated", "Invalid", "ExpiredOrRejected"] as const;
export type CredentialStatus = (typeof CREDENTIAL_STATUSES)[number];

export class CredentialDecryptError extends Error {
  readonly code = "CREDENTIAL_DECRYPT_FAILED" as const;

  constructor() {
    super("已保存的凭据无法在当前 Windows 用户环境中解密，请重新输入。");
    this.name = "CredentialDecryptError";
  }
}

export class CredentialEncryptionUnavailableError extends Error {
  readonly code = "CREDENTIAL_ENCRYPTION_UNAVAILABLE" as const;

  constructor() {
    super("系统安全存储暂不可用，请稍后重试。");
    this.name = "CredentialEncryptionUnavailableError";
  }
}

export interface SafeStoragePort {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

type EncryptedRecord = Record<string, string>;

export class SafeStorageCredentialStore implements CredentialStore {
  private readonly values: EncryptedRecord;

  constructor(private readonly filePath: string, private readonly safeStorage: SafeStoragePort) {
    this.values = this.read();
  }

  get(key: string): string | null {
    const encrypted = this.values[key];
    if (!encrypted) return null;
    try {
      return this.safeStorage.decryptString(Buffer.from(encrypted, "base64"));
    } catch {
      throw new CredentialDecryptError();
    }
  }

  set(key: string, value: string): void {
    this.setMany({ [key]: value });
  }

  /** Encrypt the complete bundle before one file replacement; no partial key rotation. */
  setMany(values: Readonly<Record<string, string>>): void {
    if (!this.safeStorage.isEncryptionAvailable()) throw new CredentialEncryptionUnavailableError();
    const encrypted = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, this.safeStorage.encryptString(value).toString("base64")]));
    const next = { ...this.values, ...encrypted };
    this.persist(next);
    Object.assign(this.values, encrypted);
  }

  delete(key: string): void {
    if (!(key in this.values)) return;
    const next = { ...this.values };
    delete next[key];
    this.persist(next);
    delete this.values[key];
  }

  has(key: string): boolean {
    if (typeof this.values[key] !== "string") return false;
    return this.getStatus(key) === "Configured";
  }

  getStatus(key: string): CredentialStatus {
    if (typeof this.values[key] !== "string") return "NotConfigured";
    try {
      this.get(key);
      return "Configured";
    } catch (error) {
      if (error instanceof CredentialDecryptError) return "DecryptFailed";
      return "DecryptFailed";
    }
  }

  private read(): EncryptedRecord {
    if (!existsSync(this.filePath)) return {};
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.filePath, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string"));
    } catch {
      return {};
    }
  }

  private persist(values: EncryptedRecord): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tempPath = join(dirname(this.filePath), `.credentials-${process.pid}.tmp`);
    writeFileSync(tempPath, JSON.stringify(values), { encoding: "utf8", mode: 0o600 });
    renameSync(tempPath, this.filePath);
  }
}
