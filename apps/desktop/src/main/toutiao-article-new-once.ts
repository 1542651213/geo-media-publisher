import { closeSync, fsyncSync, mkdirSync, openSync, writeSync } from "node:fs";
import { join } from "node:path";

/** Task-wide, fail-closed claim. A crash after this point does not authorize another request. */
export function claimControlledArticleNewCapture(dataDirectory: string): string {
  const directory = join(dataDirectory, "diagnostics");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "toutiao-mvp-3-5-article-new.claim");
  let descriptor: number;
  try { descriptor = openSync(path, "wx", 0o600); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST")
      throw new Error("TOUTIAO_ARTICLE_NEW_ALREADY_CLAIMED");
    throw new Error("TOUTIAO_ARTICLE_NEW_CLAIM_FAILED");
  }
  try {
    writeSync(descriptor, JSON.stringify({ task: "TOUTIAO_MVP_3_5_CONTROLLED_ARTICLE_NEW_CAPTURE", claimedAt: new Date().toISOString() }));
    fsyncSync(descriptor);
  } finally { closeSync(descriptor); }
  return path;
}
