import { createHash } from "node:crypto";
import { canonicalSerialize, deepFreeze, hashToutiaoContentBinding, normalizeToutiaoSettings, ToutiaoPreparationError, validateRemoteSchedule, validateTitle, type RemoteScheduleConstraint, type TitleConstraint, type ToutiaoArticleSettingsSnapshot } from "@publisher/domain";
import { assertAssetSnapshotCurrent, makeAssetUploadKey, snapshotLocalAsset, type LocalAssetSource, type ToutiaoAssetSnapshot } from "./assets";
import { normalizeToutiaoArticleContent, replaceImageSources } from "./content";

export interface ToutiaoArticlePreparedPayload {
  readonly version: 1;
  readonly jobId: string;
  readonly articleId: string;
  readonly accountId: string;
  readonly brandId: string;
  readonly title: string;
  /** Local images are immutable asset://sha256 placeholders until a later upload phase resolves them. */
  readonly normalizedHtml: string;
  readonly plainText: string;
  readonly coverMode: ToutiaoArticleSettingsSnapshot["coverMode"];
  readonly coverUploadKeys: readonly string[];
  readonly bodyImageUploadKeys: readonly string[];
  readonly articleAdType: ToutiaoArticleSettingsSnapshot["articleAdType"];
  readonly remoteScheduledAt: string | null;
  readonly settingsSnapshotVersion: number;
  readonly assetSnapshots: readonly ToutiaoAssetSnapshot[];
  readonly sourceContentHash: string;
  readonly preparedAt: string;
}

export interface ToutiaoArticlePreparationInput {
  readonly jobId: string;
  readonly articleId: string;
  readonly accountId: string;
  readonly brandId: string;
  readonly title: string;
  readonly html: string;
  readonly settings: ToutiaoArticleSettingsSnapshot;
  readonly resolveAsset: (assetIdOrPath: string) => LocalAssetSource | null;
  readonly now: Date;
  readonly platformHostedDomains?: readonly string[];
  readonly titleConstraint?: TitleConstraint;
  readonly scheduleConstraint?: RemoteScheduleConstraint;
}

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }

export function prepareToutiaoArticlePayload(input: ToutiaoArticlePreparationInput): { readonly payload: Readonly<ToutiaoArticlePreparedPayload>; readonly canonicalJson: string; readonly payloadHash: string; readonly contentBindingHash: string } {
  const settings = normalizeToutiaoSettings(input.settings);
  const title = input.title.trim().normalize("NFC");
  const titleErrors = validateTitle(title, input.titleConstraint ?? { minimum: 1, measurement: "js_length", provenance: "UNVERIFIED_PLATFORM_RULE" });
  if (titleErrors[0]) throw new ToutiaoPreparationError(titleErrors[0]);
  const scheduleErrors = validateRemoteSchedule(settings.remoteScheduledAt, input.scheduleConstraint ?? { supportsRemoteScheduling: true, provenance: "UNVERIFIED_PLATFORM_RULE" }, input.now);
  if (scheduleErrors[0]) throw new ToutiaoPreparationError(scheduleErrors[0]);
  const content = normalizeToutiaoArticleContent(input.html, { platformHostedDomains: input.platformHostedDomains });
  if (content.diagnostics.length) throw new ToutiaoPreparationError("UNSUPPORTED_IMAGE_SOURCE", "HTML contains an image with no usable source");
  const snapshotsById = new Map<string, ToutiaoAssetSnapshot>();
  const resolve = (source: string): ToutiaoAssetSnapshot => {
    const lookup = source.startsWith("asset://") ? source.slice("asset://".length) : source;
    const asset = input.resolveAsset(lookup);
    if (!asset) throw new ToutiaoPreparationError("ASSET_NOT_FOUND");
    const existing = snapshotsById.get(asset.assetId);
    if (existing) return existing;
    const snapshot = snapshotLocalAsset(asset, input.brandId, input.now.toISOString());
    snapshotsById.set(asset.assetId, snapshot);
    return snapshot;
  };
  const replacements = new Map<string, string>();
  const bodyImageUploadKeys: string[] = [];
  for (const reference of content.imageReferences) {
    if (reference.classification === "REMOTE_EXTERNAL") throw new ToutiaoPreparationError("UNRESOLVED_EXTERNAL_IMAGE");
    if (reference.classification === "MISSING" || reference.classification === "UNSUPPORTED" || !reference.source) throw new ToutiaoPreparationError("UNSUPPORTED_IMAGE_SOURCE");
    if (reference.classification === "LOCAL_ASSET") {
      const snapshot = resolve(reference.source);
      bodyImageUploadKeys.push(makeAssetUploadKey("toutiao", input.accountId, snapshot.byteSha256));
      replacements.set(reference.source, `asset://sha256/${snapshot.byteSha256}`);
    }
  }
  const coverUploadKeys = settings.coverImages.map((assetId) => {
    const snapshot = resolve(assetId);
    return makeAssetUploadKey("toutiao", input.accountId, snapshot.byteSha256);
  });
  const payload: ToutiaoArticlePreparedPayload = {
    version: 1, jobId: input.jobId, articleId: input.articleId, accountId: input.accountId, brandId: input.brandId,
    title, normalizedHtml: replaceImageSources(content.normalizedHtml, content.imageReferences, replacements), plainText: content.plainText,
    coverMode: settings.coverMode, coverUploadKeys, bodyImageUploadKeys, articleAdType: settings.articleAdType,
    remoteScheduledAt: settings.remoteScheduledAt, settingsSnapshotVersion: settings.version,
    assetSnapshots: [...snapshotsById.values()].sort((left, right) => left.assetId < right.assetId ? -1 : left.assetId > right.assetId ? 1 : 0),
    sourceContentHash: hash(canonicalSerialize({ title: input.title, html: input.html, settings,
      assetByteHashes: [...new Set([...snapshotsById.values()].map((snapshot) => snapshot.byteSha256))].sort() })), preparedAt: input.now.toISOString()
  };
  const frozen = deepFreeze(payload);
  const canonicalJson = canonicalSerialize(frozen);
  return { payload: frozen, canonicalJson, payloadHash: hash(canonicalJson), contentBindingHash: hashToutiaoContentBinding(frozen) };
}

export function assertPreparedPayloadBinding(payload: ToutiaoArticlePreparedPayload, expectedHash: string): void {
  if (hash(canonicalSerialize(payload)) !== expectedHash) throw new ToutiaoPreparationError("PAYLOAD_BINDING_MISMATCH");
}

export function assertContentBinding(payload: ToutiaoArticlePreparedPayload, expectedHash: string): void {
  if (hashToutiaoContentBinding(payload) !== expectedHash) throw new ToutiaoPreparationError("PAYLOAD_BINDING_MISMATCH");
}

export function assertPreparedAssetsCurrent(payload: ToutiaoArticlePreparedPayload): void {
  for (const snapshot of payload.assetSnapshots) assertAssetSnapshotCurrent(snapshot);
}
