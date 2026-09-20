import { closeSync, fsyncSync, mkdirSync, openSync, writeSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright-core";
import { XhsProductionReceiptObserver, type XhsReceiptEvent, type XhsReceiptMeta } from "@publisher/adapters-xiaohongshu/browser";

/**
 * Normal-runtime capture is deliberately separate from a finite publishing
 * authorization.  It stores only the observer's redacted event format and
 * does not classify an XHS response as accepted without a reviewed contract.
 */
export function createXhsReceiptCaptureFactory(dataDirectory: string, buildSha256: string): (page: Page, meta: XhsReceiptMeta) => XhsProductionReceiptObserver {
  if (!/^[0-9a-f]{64}$/iu.test(buildSha256)) throw new Error("XHS_RECEIPT_CAPTURE_BUILD_IDENTITY_REQUIRED");
  const receiptDirectory = join(dataDirectory, "xhs-receipt-evidence");
  mkdirSync(receiptDirectory, { recursive: true });
  return (page, meta) => {
    if (meta.buildSha256.toLowerCase() !== buildSha256.toLowerCase() || !meta.accountId || !meta.creatorId || !meta.jobId || !meta.intentId || !meta.snapshotId || !meta.contextId || !meta.pageId) throw new Error("XHS_RECEIPT_CAPTURE_BINDING_MISMATCH");
    const receiptPath = join(receiptDirectory, `${meta.intentId}.jsonl`);
    const persist = (event: XhsReceiptEvent): void => {
      const descriptor = openSync(receiptPath, "a", 0o600);
      try { writeSync(descriptor, `${JSON.stringify(event)}\n`); fsyncSync(descriptor); }
      finally { closeSync(descriptor); }
    };
    return new XhsProductionReceiptObserver(page, meta, persist);
  };
}
