import type { AppRepository } from "@publisher/db";
import { ONE_SHOT_REAL_PUBLISH_ACCEPTANCE, OWNER_AUTHORIZED_ONE_SHOT_TEST_PUBLISH, type FailedOneShotConfirmationIdentity, type OneShotConfirmationReconciliationResult, type OneShotConfirmationReconciliationSnapshot } from "@publisher/domain";
import type { Logger } from "@publisher/logger";

const CONFIRMATION_STEP = "PUBLISH_CONFIRMATION";
const CONFIRMATION_ERROR = "ONE_SHOT_PUBLISH_CONFIRMATION_REQUIRED";

export interface OneShotConfirmationReconciliationDecision {
  allowed: boolean;
  alreadyReconciled: boolean;
  reason: string | null;
}

export function evaluateStrictFailedOneShotConfirmation(snapshot: OneShotConfirmationReconciliationSnapshot): OneShotConfirmationReconciliationDecision {
  const step = snapshot.run.steps.find((item) => item.stepKey === CONFIRMATION_STEP);
  if (snapshot.identity.platformKey !== "xiaohongshu") return { allowed: false, alreadyReconciled: false, reason: "ONE_SHOT_RECONCILIATION_PLATFORM_MISMATCH" };
  if (!snapshot.identity.accountId.trim()) return { allowed: false, alreadyReconciled: false, reason: "ONE_SHOT_RECONCILIATION_ACCOUNT_MISMATCH" };
  if (snapshot.run.platformKey !== "xiaohongshu" || snapshot.run.accountId !== snapshot.identity.accountId || snapshot.run.platformAccountId !== snapshot.identity.accountId) return { allowed: false, alreadyReconciled: false, reason: "ONE_SHOT_RECONCILIATION_ACCOUNT_MISMATCH" };
  if (snapshot.run.requestedLevel !== "L5_PUBLISH" || snapshot.run.overallResult !== "WAITING_FOR_USER") return { allowed: false, alreadyReconciled: false, reason: "ONE_SHOT_RECONCILIATION_STATE_MISMATCH" };
  if (snapshot.authorizationCount !== 0) return { allowed: false, alreadyReconciled: false, reason: "ONE_SHOT_RECONCILIATION_AUTHORIZATION_EXISTS" };
  if (snapshot.operationCount !== 0) return { allowed: false, alreadyReconciled: false, reason: "ONE_SHOT_RECONCILIATION_OPERATION_EXISTS" };
  if (snapshot.publicationTransactionCount !== 0) return { allowed: false, alreadyReconciled: false, reason: "ONE_SHOT_RECONCILIATION_PUBLICATION_STARTED" };
  if (snapshot.finalSubmitAttemptCount !== 0) return { allowed: false, alreadyReconciled: false, reason: "ONE_SHOT_RECONCILIATION_FINAL_SUBMIT_STARTED" };
  if (snapshot.externalPublicationEvidence) return { allowed: false, alreadyReconciled: false, reason: "ONE_SHOT_RECONCILIATION_EXTERNAL_EVIDENCE_EXISTS" };
  if (snapshot.needsReconciliation) return { allowed: false, alreadyReconciled: false, reason: "ONE_SHOT_RECONCILIATION_NEEDS_RECONCILIATION" };
  if (snapshot.publishedOrVerified) return { allowed: false, alreadyReconciled: false, reason: "ONE_SHOT_RECONCILIATION_ALREADY_PUBLISHED" };
  if (!step || step.result !== "WAITING_FOR_USER" || step.errorCode !== CONFIRMATION_ERROR) return { allowed: false, alreadyReconciled: false, reason: "ONE_SHOT_RECONCILIATION_CONFIRMATION_STEP_MISMATCH" };
  if (snapshot.run.publishConfirmedAt === null) return { allowed: true, alreadyReconciled: true, reason: null };
  return { allowed: true, alreadyReconciled: false, reason: null };
}

export interface OneShotConfirmationReconciliationServiceOptions {
  repository: Pick<AppRepository, "getOneShotConfirmationReconciliationSnapshot" | "reconcileFailedOneShotConfirmation">;
  logger?: Logger;
}

export class OneShotConfirmationReconciliationService {
  constructor(private readonly options: OneShotConfirmationReconciliationServiceOptions) {}

  reconcileFailedOneShotConfirmation(identity: FailedOneShotConfirmationIdentity): OneShotConfirmationReconciliationResult {
    if (identity.platformKey !== "xiaohongshu" || !identity.accountId.trim()) throw Object.assign(new Error("ONE_SHOT_RECONCILIATION_IDENTITY_MISMATCH"), { code: "ONE_SHOT_RECONCILIATION_IDENTITY_MISMATCH" });
    const snapshot = this.options.repository.getOneShotConfirmationReconciliationSnapshot(identity);
    this.options.logger?.info("PLATFORM_SELF_TEST", "PARTIAL_CONFIRMATION_STATE_DETECTED", "检测到指定的一次性确认 partial state；开始严格资格判断", {
      testRunId: identity.testRunId,
      operationId: identity.testRunId,
      platformKey: identity.platformKey,
      accountId: identity.accountId,
      authorizationCount: snapshot.authorizationCount,
      operationCount: snapshot.operationCount,
      publicationTransactionCount: snapshot.publicationTransactionCount,
      finalSubmitAttemptCount: snapshot.finalSubmitAttemptCount,
      externalPublicationEvidence: snapshot.externalPublicationEvidence
    });
    const decision = evaluateStrictFailedOneShotConfirmation(snapshot);
    if (!decision.allowed) throw Object.assign(new Error(decision.reason ?? "ONE_SHOT_RECONCILIATION_NOT_ALLOWED"), { code: decision.reason ?? "ONE_SHOT_RECONCILIATION_NOT_ALLOWED" });
    if (decision.alreadyReconciled) {
      const result: OneShotConfirmationReconciliationResult = { status: "ALREADY_RECONCILED", testRunId: identity.testRunId, mutationCount: 0, retryEligible: true };
      this.options.logger?.info("PLATFORM_SELF_TEST", "PARTIAL_CONFIRM_RECONCILIATION_RESULT", "指定的一次性确认已处于可重试状态；不重复修改", { testRunId: identity.testRunId, operationId: identity.testRunId, status: result.status, mutationCount: result.mutationCount, retryEligible: result.retryEligible });
      return result;
    }
    this.options.logger?.info("PLATFORM_SELF_TEST", "PARTIAL_CONFIRM_RECONCILIATION_STARTED", "开始通过正式 service/repository transaction 恢复一次性确认资格", { testRunId: identity.testRunId, operationId: identity.testRunId, platformKey: identity.platformKey, accountId: identity.accountId, mode: ONE_SHOT_REAL_PUBLISH_ACCEPTANCE, authorization: OWNER_AUTHORIZED_ONE_SHOT_TEST_PUBLISH });
    try {
      const result = this.options.repository.reconcileFailedOneShotConfirmation(identity);
      this.options.logger?.info("PLATFORM_SELF_TEST", "PARTIAL_CONFIRM_RECONCILIATION_COMMITTED", "一次性确认 partial state 已恢复为 canonical retryable pre-confirm state", { testRunId: identity.testRunId, operationId: identity.testRunId, status: result.status, mutationCount: result.mutationCount, retryEligible: result.retryEligible, authorizationCreated: false, operationCreated: false, publicationTransactionCount: 0, finalSubmitCount: 0 });
      this.options.logger?.info("PLATFORM_SELF_TEST", "PARTIAL_CONFIRM_RECONCILIATION_RESULT", "一次性确认 reconciliation 完成", { testRunId: identity.testRunId, operationId: identity.testRunId, status: result.status, mutationCount: result.mutationCount, retryEligible: result.retryEligible });
      return result;
    } catch (error) {
      this.options.logger?.warn("PLATFORM_SELF_TEST", "PARTIAL_CONFIRM_RECONCILIATION_ROLLED_BACK", "一次性确认 reconciliation 失败；未保留部分状态", { testRunId: identity.testRunId, operationId: identity.testRunId, errorType: error instanceof Error ? error.name : "UnknownError", failureCode: error instanceof Error && "code" in error ? (error as { code?: unknown }).code : undefined });
      throw error;
    }
  }
}
