import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export interface DouyinImageTextSource {
  articleId: string;
  accountId: string;
  creatorId: string;
  title: string;
  body: string;
  imagePaths: readonly string[];
  topics: readonly string[];
  visibility: "public";
  scheduledAt: null;
  mandatorySelections?: readonly { key: string; value: string }[];
  musicBinding?: DouyinMusicBinding;
}

export type DouyinMusicBinding = { mode: "NONE" } | {
  mode: "AUTO_RECOMMENDED"; identity: string; trackId: string | null; title: string; artist: string; duration: string;
};

/** Owner-selected R1 candidate settings. No default is supplied by the Job factory. */
export interface DouyinImageTextJobSettings {
  version: 1;
  visibility: "public";
  timing: "immediate";
  musicMode?: "NONE" | "AUTO_RECOMMENDED";
}

export interface FrozenDouyinImageText extends DouyinImageTextSource {
  readonly transport: "DOUYIN_IMAGE_TEXT_BROWSER";
  readonly imageHashes: readonly string[];
  readonly sourceContentHash: string;
  readonly contentBindingHash: string;
}

export interface DouyinImageTextEditorReadback {
  accountId: string;
  creatorId: string;
  contextOwned: boolean;
  sessionActive: boolean;
  pageHost: string;
  title: string;
  body: string;
  imageCount: number;
  requiredFieldsPresent: boolean;
  finalSubmitControlCount: number;
  securityChallenge: boolean;
}

/** Validates browser evidence immediately before a durable final-submit claim. */
export function assertDouyinImageTextReadback(frozen: FrozenDouyinImageText, observed: DouyinImageTextEditorReadback): {
  imageReadback: "PASS"; titleReadback: "PASS"; bodyReadback: "PASS"; requiredFields: "PASS";
} {
  if (observed.accountId !== frozen.accountId) throw new Error("ACCOUNT_MISMATCH");
  if (observed.creatorId !== frozen.creatorId) throw new Error("IDENTITY_MISMATCH");
  if (!observed.contextOwned) throw new Error("CONTEXT_MISMATCH");
  if (!observed.sessionActive) throw new Error("SESSION_EXPIRED");
  if (observed.pageHost !== "creator.douyin.com") throw new Error("CREATOR_HOST_MISMATCH");
  if (observed.securityChallenge) throw new Error("SECURITY_VERIFICATION_REQUIRED");
  if (observed.imageCount !== frozen.imageHashes.length) throw new Error("IMAGE_COUNT_MISMATCH");
  if (observed.title !== frozen.title) throw new Error("TITLE_MISMATCH");
  if (observed.body !== frozen.body) throw new Error("BODY_MISMATCH");
  if (!observed.requiredFieldsPresent) throw new Error("REQUIRED_FIELDS_MISSING");
  if (observed.finalSubmitControlCount !== 1) throw new Error("FINAL_CONTROL_AMBIGUOUS");
  return { imageReadback: "PASS", titleReadback: "PASS", bodyReadback: "PASS", requiredFields: "PASS" };
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function supportedImage(bytes: Uint8Array): boolean {
  return bytes.length > 8 && (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    || bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  );
}

export async function freezeDouyinImageText(source: DouyinImageTextSource): Promise<FrozenDouyinImageText> {
  if (!source.articleId.trim() || !source.accountId.trim() || !source.creatorId.trim()) throw new Error("Douyin account identity and Article binding are required");
  if (!source.title.trim() || !source.body.trim()) throw new Error("Douyin image-text title and body are required");
  if (/<\/?[a-z][^>]*>/iu.test(source.title) || /<\/?[a-z][^>]*>/iu.test(source.body)) throw new Error("Douyin image-text requires plain text");
  if (source.imagePaths.length !== 1 || !source.imagePaths[0]?.trim()) throw new Error("Douyin R0 requires exactly one image");
  if (source.topics.length !== 0) throw new Error("Douyin R0 topic support is unavailable");
  if (source.visibility !== "public" || source.scheduledAt !== null) throw new Error("Douyin R0 visibility and schedule are fixed");
  const bytes = await readFile(source.imagePaths[0]);
  if (!supportedImage(bytes)) throw new Error("Douyin image must be a nonempty PNG or JPEG");
  const imageHashes = [sha256(bytes)];
  const mandatorySelections = [...(source.mandatorySelections ?? [])].map(({ key, value }) => ({ key: key.trim(), value: value.trim() }))
    .sort((a, b) => a.key.localeCompare(b.key));
  if (mandatorySelections.some(({ key, value }) => !key || !value)) throw new Error("Douyin mandatory setting snapshot is incomplete");
  const musicBinding = source.musicBinding;
  if (musicBinding?.mode === "AUTO_RECOMMENDED" &&
    (!musicBinding.identity.trim() || !musicBinding.title.trim() || !musicBinding.artist.trim() || !musicBinding.duration.trim()))
    throw new Error("Douyin selected music identity is incomplete");
  const sourceContentHash = sha256(JSON.stringify({ version: 1, title: source.title, body: source.body,
    imageHashes, topics: source.topics, visibility: source.visibility, scheduledAt: source.scheduledAt, mandatorySelections,
    ...(musicBinding ? { musicBinding } : {}) }));
  const transport = "DOUYIN_IMAGE_TEXT_BROWSER" as const;
  const contentBindingHash = sha256(JSON.stringify({ version: 1, articleId: source.articleId,
    accountId: source.accountId, creatorId: source.creatorId, transport, sourceContentHash }));
  return Object.freeze({ ...source, mandatorySelections: Object.freeze(mandatorySelections), imagePaths: Object.freeze([...source.imagePaths]), topics: Object.freeze([...source.topics]),
    transport, imageHashes: Object.freeze(imageHashes), sourceContentHash, contentBindingHash });
}

export async function verifyDouyinImageTextImage(frozen: FrozenDouyinImageText, index: number): Promise<boolean> {
  const path = frozen.imagePaths[index];
  const expectedHash = frozen.imageHashes[index];
  if (!path || !expectedHash) return false;
  try { return sha256(await readFile(path)) === expectedHash; }
  catch { return false; }
}
