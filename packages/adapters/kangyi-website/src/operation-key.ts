import { createHash } from "node:crypto";
import type { DeployEnvironment } from "@publisher/cms-v2-client";

export type KangyiOperation = "media" | "create" | "draft" | "validate" | "publish";

export interface KangyiOperationBinding {
  publishJobId: string;
  submissionIntentId: string;
  contentBindingId: string;
  siteId: string;
  environment: DeployEnvironment;
  operation: KangyiOperation;
  immutableIdentity: string;
}

function required(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} is required for Kangyi operation binding`);
  return normalized;
}

/**
 * Derives a stable, secret-free key for exactly one retained CMS operation.
 * The prefix and SHA-256 digest remain within the server Idempotency-Key regex.
 */
export function createKangyiOperationKey(binding: KangyiOperationBinding): string {
  const canonical = [
    "kangyi-cms-v2",
    required(binding.publishJobId, "publishJobId"),
    required(binding.submissionIntentId, "submissionIntentId"),
    required(binding.contentBindingId, "contentBindingId"),
    required(binding.siteId, "siteId"),
    required(binding.environment, "environment"),
    required(binding.operation, "operation"),
    required(binding.immutableIdentity, "immutableIdentity")
  ].join("\n");
  return `kangyi_v2_${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}
