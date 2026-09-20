import type { PublishJob } from "./types";

export interface SubmissionActionResult {
  ok: boolean;
  code: "RETRY_READY" | "SUBMISSION_RECONCILIATION_REQUIRED" | "NEGATIVE_PROOF_UNAVAILABLE" | "NEGATIVE_PROOF_REJECTED";
  job: PublishJob;
  message: string;
}
export interface SubmissionReconciliationRequest {
  intentId: string;
  jobId: string;
  accountId: string;
  articleId: string;
  platformKey: string;
  externalId: string | null;
  intentUpdatedAt: string;
}
/** A reviewed adapter must prove the old operation cannot be accepted now OR later.
 * Search absence, timeouts and client assertions do not meet this contract. */
export interface SubmissionNegativeEvidence extends SubmissionReconciliationRequest {
  status: "NOT_SUBMITTED";
  operationClosed: true;
  evidenceId: string;
  observedAt: string;
}
