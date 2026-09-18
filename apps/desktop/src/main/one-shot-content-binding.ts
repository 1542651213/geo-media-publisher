import { createHash, randomUUID } from "node:crypto";
const canonicalize = (value: string): string => value.replace(/\r\n?/gu, "\n");

export interface OneShotContentPayload {
  platformKey: "xiaohongshu";
  accountId: string;
  creatorId: string;
  title: string;
  body: string;
  imageAssetId: string;
  imageSha256?: string | null;
}

export interface OneShotContentBinding {
  contentBindingId: string;
  platformKey: "xiaohongshu";
  accountId: string;
  creatorId: string;
  titleCanonical: string;
  bodyCanonical: string;
  titleSha256: string;
  bodySha256: string;
  imageAssetId: string;
  imageSha256: string | null;
}

export type OneShotContentBindingVerification = {
  status: "PASS" | "PASS_WITH_NORMALIZATION" | "FAIL";
  reasons: string[];
};

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function validateOneShotContentPayload(payload: Partial<OneShotContentPayload>): asserts payload is OneShotContentPayload {
  if (payload.platformKey !== "xiaohongshu" || !payload.accountId?.trim() || !payload.creatorId?.trim() || !payload.title?.trim() || !payload.body?.trim() || !payload.imageAssetId?.trim()) {
    throw new Error("ONE_SHOT_CONTENT_PAYLOAD_REQUIRED");
  }
  if (payload.imageSha256 !== undefined && payload.imageSha256 !== null && !/^[a-f0-9]{64}$/iu.test(payload.imageSha256)) {
    throw new Error("ONE_SHOT_CONTENT_PAYLOAD_INVALID_IMAGE_HASH");
  }
}

export function buildOneShotContentBinding(payload: OneShotContentPayload): OneShotContentBinding {
  validateOneShotContentPayload(payload);
  const titleCanonical = canonicalize(payload.title);
  const bodyCanonical = canonicalize(payload.body);
  return {
    contentBindingId: randomUUID(),
    platformKey: payload.platformKey,
    accountId: payload.accountId,
    creatorId: payload.creatorId,
    titleCanonical,
    bodyCanonical,
    titleSha256: sha256(titleCanonical),
    bodySha256: sha256(bodyCanonical),
    imageAssetId: payload.imageAssetId,
    imageSha256: payload.imageSha256 ?? null
  };
}

export function verifyOneShotContentBinding(binding: OneShotContentBinding, payload: OneShotContentPayload): OneShotContentBindingVerification {
  const reasons: string[] = [];
  try { validateOneShotContentPayload(payload); } catch { return { status: "FAIL", reasons: ["ONE_SHOT_CONTENT_PAYLOAD_REQUIRED"] }; }
  if (payload.platformKey !== binding.platformKey) reasons.push("PLATFORM_MISMATCH");
  if (payload.accountId !== binding.accountId) reasons.push("ACCOUNT_MISMATCH");
  if (payload.creatorId !== binding.creatorId) reasons.push("CREATOR_MISMATCH");
  if (payload.imageAssetId !== binding.imageAssetId) reasons.push("IMAGE_ASSET_MISMATCH");
  if ((payload.imageSha256 ?? null) !== binding.imageSha256) reasons.push("IMAGE_HASH_MISMATCH");
  const titleCanonical = canonicalize(payload.title);
  const bodyCanonical = canonicalize(payload.body);
  if (sha256(titleCanonical) !== binding.titleSha256) reasons.push("TITLE_HASH_MISMATCH");
  if (sha256(bodyCanonical) !== binding.bodySha256) reasons.push("BODY_HASH_MISMATCH");
  if (reasons.length > 0) return { status: "FAIL", reasons };
  const normalized = titleCanonical !== payload.title || bodyCanonical !== payload.body;
  return { status: normalized ? "PASS_WITH_NORMALIZATION" : "PASS", reasons: [...(titleCanonical !== payload.title ? ["TITLE_CRLF_OR_CR_TO_LF"] : []), ...(bodyCanonical !== payload.body ? ["BODY_CRLF_OR_CR_TO_LF"] : [])] };
}
