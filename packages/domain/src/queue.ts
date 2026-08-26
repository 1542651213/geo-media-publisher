import type { ErrorCode, JobStatus } from "./types";

export interface RetryDecision {
  status: JobStatus;
  nextRetryAt: string | null;
  shouldPauseAccount: boolean;
}

const retryableCodes = new Set<ErrorCode>(["NETWORK_ERROR", "TIMEOUT", "UPLOAD_FAILED", "RATE_LIMITED", "PROCESSING"]);

export function nextRetryDelayMs(attempt: number): number {
  return Math.min(60 * 60 * 1000, 15_000 * 2 ** Math.max(0, attempt - 1));
}

export function decideFailure(code: ErrorCode, attempt: number, maxAttempts: number, pauseThreshold: number): RetryDecision {
  if (code === "LOGIN_EXPIRED") return { status: "NeedsUserAction", nextRetryAt: null, shouldPauseAccount: true };
  if (["AUTH_REQUIRED", "USER_ACTION_REQUIRED", "PERMISSION_DENIED", "API_REVIEW_REQUIRED"].includes(code)) return { status: "NeedsUserAction", nextRetryAt: null, shouldPauseAccount: false };
  if (!retryableCodes.has(code) || attempt >= maxAttempts) return { status: "Failed", nextRetryAt: null, shouldPauseAccount: attempt >= pauseThreshold };
  return { status: "Retry", nextRetryAt: new Date(Date.now() + nextRetryDelayMs(attempt)).toISOString(), shouldPauseAccount: attempt >= pauseThreshold };
}

export function validJobTransition(from: JobStatus, to: JobStatus): boolean {
  const transitions: Record<JobStatus, JobStatus[]> = {
    Pending: ["Scheduled", "Preparing", "Running", "Cancelled"],
    Scheduled: ["Pending", "Preparing", "Running", "Cancelled"],
    Preparing: ["ReadyToSubmit", "Submitting", "Retry", "NeedsUserAction", "Failed", "Cancelled"],
    ReadyToSubmit: ["Submitting", "DryRunPassed", "AwaitingConfirmation", "Retry", "Cancelled"],
    Running: ["Preparing", "Submitting", "Publishing", "Success", "Retry", "NeedsUserAction", "Paused", "Failed", "Cancelled"],
    Submitting: ["Submitted", "Publishing", "Published", "NeedsReconciliation", "Failed", "Cancelled"],
    Submitted: ["Publishing", "Published", "NeedsReconciliation", "Failed"],
    Publishing: ["Submitted", "Published", "Success", "Retry", "NeedsReconciliation", "NeedsUserAction", "Failed", "Cancelled"],
    Published: [],
    DryRunPassed: ["AwaitingConfirmation", "Scheduled", "Cancelled"],
    AwaitingConfirmation: ["Scheduled", "DryRunPassed", "Cancelled"],
    Retry: ["Preparing", "Running", "Cancelled", "Paused"],
    NeedsReconciliation: ["Retry", "Submitted", "Publishing", "Published", "NeedsUserAction", "Failed", "ReconciledNotPublished", "Cancelled"],
    NeedsUserAction: ["Pending", "Scheduled", "Preparing", "Running", "Cancelled", "Paused"],
    Paused: ["Pending", "Cancelled"],
    Success: [],
    Failed: ["Retry", "Cancelled"],
    ReconciledNotPublished: [],
    Cancelled: []
  };
  return transitions[from].includes(to);
}
