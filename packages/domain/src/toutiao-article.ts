import { createHash } from "node:crypto";

/** These rules describe a configurable preparation policy, not verified Toutiao limits. */
export type RuleProvenance = "UNVERIFIED_PLATFORM_RULE" | "PLATFORM_VERIFIED";
export type TextMeasurementStrategy = "js_length" | "weighted_cjk";
export interface TitleConstraint { minimum?: number; maximum?: number; measurement: TextMeasurementStrategy; provenance: RuleProvenance }
export interface RemoteScheduleConstraint { supportsRemoteScheduling: boolean; minimumLeadTimeMs?: number; maximumFutureWindowMs?: number; provenance: RuleProvenance }
export interface CoverConstraint { supportedModes: readonly ToutiaoCoverMode[]; maximumImages?: number; provenance: RuleProvenance }
export type ContentTransport = "ARTICLE_BROWSER" | "ARTICLE_WEB_API" | "VIDEO_OFFICIAL_API";

/** Only fields that can change the remote article are part of this projection. */
export interface ToutiaoContentBindingInput {
  readonly accountId: string;
  readonly brandId: string;
  readonly title: string;
  readonly normalizedHtml: string;
  readonly coverMode: ToutiaoCoverMode;
  readonly coverUploadKeys: readonly string[];
  readonly bodyImageUploadKeys: readonly string[];
  readonly articleAdType: ToutiaoArticleAdType;
  readonly remoteScheduledAt: string | null;
  readonly settingsSnapshotVersion: number;
  readonly assetSnapshots: readonly { readonly byteSha256: string }[];
}

export type ToutiaoCoverMode = "auto" | "none" | "single" | "multiple";
export type ToutiaoArticleAdType = "none" | "platform_default";
export interface ToutiaoArticleSettingsSnapshot {
  readonly version: 1;
  readonly coverMode: ToutiaoCoverMode;
  readonly coverImages: readonly string[];
  readonly articleAdType: ToutiaoArticleAdType;
  /** Absolute UTC ISO timestamp for remote publication; never the local Job scheduledAt. */
  readonly remoteScheduledAt: string | null;
}

export const TOUTIAO_PREPARATION_ERROR_CODES = [
  "TITLE_TOO_SHORT", "TITLE_TOO_LONG", "INVALID_REMOTE_SCHEDULE", "REMOTE_SCHEDULE_TOO_SOON", "REMOTE_SCHEDULE_TOO_FAR",
  "MISSING_COVER_ASSET", "ASSET_NOT_FOUND", "ASSET_HASH_MISMATCH", "ASSET_BRAND_MISMATCH",
  "UNSUPPORTED_IMAGE_SOURCE", "UNRESOLVED_EXTERNAL_IMAGE", "PAYLOAD_BINDING_MISMATCH", "ARTICLE_API_SUBMIT_NOT_IMPLEMENTED"
] as const;
export type ToutiaoPreparationErrorCode = (typeof TOUTIAO_PREPARATION_ERROR_CODES)[number];
export class ToutiaoPreparationError extends Error {
  constructor(readonly code: ToutiaoPreparationErrorCode, message: string = code) { super(message); this.name = "ToutiaoPreparationError"; }
}

export function measureText(value: string, strategy: TextMeasurementStrategy): number {
  if (strategy === "js_length") return value.length;
  return Array.from(value).reduce((total, character) => total + (character.codePointAt(0)! <= 0x7f ? 0.5 : 1), 0);
}

export function validateTitle(value: string, constraint: TitleConstraint): ToutiaoPreparationErrorCode[] {
  const length = measureText(value.trim().normalize("NFC"), constraint.measurement);
  return [
    ...(constraint.minimum !== undefined && length < constraint.minimum ? ["TITLE_TOO_SHORT" as const] : []),
    ...(constraint.maximum !== undefined && length > constraint.maximum ? ["TITLE_TOO_LONG" as const] : [])
  ];
}

const ABSOLUTE_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/u;
export function normalizeRemoteScheduledAt(value: string): string {
  const match = ABSOLUTE_TIMESTAMP.exec(value);
  if (!match) throw new ToutiaoPreparationError("INVALID_REMOTE_SCHEDULE", "Remote schedule needs a complete timestamp with timezone");
  const offsetHours = Number(match[9] ?? 0);
  const offsetMinutes = Number(match[10] ?? 0);
  if (offsetHours > 23 || offsetMinutes > 59) throw new ToutiaoPreparationError("INVALID_REMOTE_SCHEDULE");
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) throw new ToutiaoPreparationError("INVALID_REMOTE_SCHEDULE");
  const offset = match[7] === "Z" ? 0 : (match[8] === "+" ? 1 : -1) * (offsetHours * 60 + offsetMinutes) * 60_000;
  const local = new Date(epoch + offset);
  if (local.getUTCFullYear() !== Number(match[1]) || local.getUTCMonth() + 1 !== Number(match[2]) || local.getUTCDate() !== Number(match[3]) || local.getUTCHours() !== Number(match[4]) || local.getUTCMinutes() !== Number(match[5]) || local.getUTCSeconds() !== Number(match[6])) throw new ToutiaoPreparationError("INVALID_REMOTE_SCHEDULE");
  return new Date(epoch).toISOString();
}

export function validateRemoteSchedule(value: string | null, constraint: RemoteScheduleConstraint, now: Date): ToutiaoPreparationErrorCode[] {
  if (value === null) return [];
  let epoch: number;
  try { epoch = Date.parse(normalizeRemoteScheduledAt(value)); }
  catch { return ["INVALID_REMOTE_SCHEDULE"]; }
  if (!constraint.supportsRemoteScheduling) return ["INVALID_REMOTE_SCHEDULE"];
  const lead = epoch - now.getTime();
  return [
    ...(constraint.minimumLeadTimeMs !== undefined && lead < constraint.minimumLeadTimeMs ? ["REMOTE_SCHEDULE_TOO_SOON" as const] : []),
    ...(constraint.maximumFutureWindowMs !== undefined && lead > constraint.maximumFutureWindowMs ? ["REMOTE_SCHEDULE_TOO_FAR" as const] : [])
  ];
}

export function normalizeToutiaoSettings(input: ToutiaoArticleSettingsSnapshot): ToutiaoArticleSettingsSnapshot {
  if (input.version !== 1 || !["auto", "none", "single", "multiple"].includes(input.coverMode) || !["none", "platform_default"].includes(input.articleAdType)) throw new ToutiaoPreparationError("MISSING_COVER_ASSET", "Unsupported article settings");
  if ((input.coverMode === "single" && input.coverImages.length !== 1) || (input.coverMode === "multiple" && input.coverImages.length < 2) || (["auto", "none"].includes(input.coverMode) && input.coverImages.length !== 0)) throw new ToutiaoPreparationError("MISSING_COVER_ASSET", "Cover images do not match the selected cover mode");
  const coverImages = input.coverImages.map((id) => id.trim());
  if (coverImages.some((id) => !id)) throw new ToutiaoPreparationError("MISSING_COVER_ASSET");
  return deepFreeze({ version: 1, coverMode: input.coverMode, coverImages, articleAdType: input.articleAdType, remoteScheduledAt: input.remoteScheduledAt === null ? null : normalizeRemoteScheduledAt(input.remoteScheduledAt) });
}

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") { if (!Number.isFinite(value)) throw new Error("Canonical payload cannot contain a non-finite number"); return value; }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === "object") {
    const entries = Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    return Object.fromEntries(entries.map(([key, entry]) => [key, canonicalValue(entry)]));
  }
  throw new Error("Canonical payload contains an unsupported value");
}

export function canonicalSerialize(value: unknown): string { return JSON.stringify(canonicalValue(value)); }
export function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(canonicalSerialize(value)).digest("hex");
}

export function hashToutiaoContentBinding(input: ToutiaoContentBindingInput): string {
  if (!input || typeof input.accountId !== "string" || !input.accountId || typeof input.brandId !== "string" || !input.brandId
    || typeof input.title !== "string" || !input.title || typeof input.normalizedHtml !== "string"
    || !Array.isArray(input.coverUploadKeys) || !Array.isArray(input.bodyImageUploadKeys) || !Array.isArray(input.assetSnapshots)
    || input.coverUploadKeys.some((key) => typeof key !== "string") || input.bodyImageUploadKeys.some((key) => typeof key !== "string")
    || !["auto", "none", "single", "multiple"].includes(input.coverMode) || !["none", "platform_default"].includes(input.articleAdType)
    || input.remoteScheduledAt !== null && typeof input.remoteScheduledAt !== "string"
    || !Number.isInteger(input.settingsSnapshotVersion) || input.settingsSnapshotVersion < 1) throw new ToutiaoPreparationError("PAYLOAD_BINDING_MISMATCH");
  if (input.assetSnapshots.some((asset) => !asset || typeof asset.byteSha256 !== "string")) throw new ToutiaoPreparationError("PAYLOAD_BINDING_MISMATCH");
  const assetByteHashes = [...new Set(input.assetSnapshots.map((asset) => asset.byteSha256))].sort();
  if (assetByteHashes.some((value) => !/^[a-f0-9]{64}$/u.test(value))) throw new ToutiaoPreparationError("PAYLOAD_BINDING_MISMATCH");
  return sha256Canonical({ version: 1, accountId: input.accountId, brandId: input.brandId, title: input.title,
    normalizedHtml: input.normalizedHtml, coverMode: input.coverMode, coverUploadKeys: input.coverUploadKeys,
    bodyImageUploadKeys: input.bodyImageUploadKeys, articleAdType: input.articleAdType,
    remoteScheduledAt: input.remoteScheduledAt, settingsSnapshotVersion: input.settingsSnapshotVersion, assetByteHashes });
}

export function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
