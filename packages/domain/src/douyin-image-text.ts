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
}

export interface FrozenDouyinImageText extends DouyinImageTextSource {
  readonly transport: "DOUYIN_BROWSER_NATIVE";
  readonly imageHashes: readonly string[];
  readonly sourceContentHash: string;
  readonly contentBindingHash: string;
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
  const sourceContentHash = sha256(JSON.stringify({ version: 1, title: source.title, body: source.body,
    imageHashes, topics: source.topics, visibility: source.visibility, scheduledAt: source.scheduledAt }));
  const transport = "DOUYIN_BROWSER_NATIVE" as const;
  const contentBindingHash = sha256(JSON.stringify({ version: 1, articleId: source.articleId,
    accountId: source.accountId, creatorId: source.creatorId, transport, sourceContentHash }));
  return Object.freeze({ ...source, imagePaths: Object.freeze([...source.imagePaths]), topics: Object.freeze([...source.topics]),
    transport, imageHashes: Object.freeze(imageHashes), sourceContentHash, contentBindingHash });
}

export async function verifyDouyinImageTextImage(frozen: FrozenDouyinImageText, index: number): Promise<boolean> {
  const path = frozen.imagePaths[index];
  const expectedHash = frozen.imageHashes[index];
  if (!path || !expectedHash) return false;
  try { return sha256(await readFile(path)) === expectedHash; }
  catch { return false; }
}
