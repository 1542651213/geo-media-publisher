import {
  ONE_SHOT_REAL_PUBLISH_ACCEPTANCE,
  OWNER_AUTHORIZED_ONE_SHOT_TEST_PUBLISH,
  type OneShotPublicationAuthorization,
  type OneShotPublicationAuthorizationState
} from "@publisher/domain";

export {
  ONE_SHOT_REAL_PUBLISH_ACCEPTANCE,
  OWNER_AUTHORIZED_ONE_SHOT_TEST_PUBLISH
} from "@publisher/domain";
export type { OneShotPublicationAuthorization, OneShotPublicationAuthorizationState } from "@publisher/domain";

export const MAX_PUBLICATION_TRANSACTIONS = 1 as const;
export const MAX_FINAL_SUBMIT_ATTEMPTS = 1 as const;
export const FINAL_SUBMIT_RETRY_COUNT = 0 as const;
export const MAX_PUBLICATION_COMMIT_ACTIONS = 2 as const;

export interface OneShotFinalSubmitControlEvidence {
  status: "FOUND_UNIQUE" | "NOT_FOUND" | "AMBIGUOUS" | "NOT_VISIBLE" | "DISABLED" | "HITTEST_INVALID";
  visible: boolean;
  enabled: boolean;
  hitTestValid: boolean;
  label?: string;
}

export interface OneShotFinalSubmitPreflight {
  authorization: typeof OWNER_AUTHORIZED_ONE_SHOT_TEST_PUBLISH;
  authorizationState: OneShotPublicationAuthorizationState;
  platformKey: "xiaohongshu";
  accountId: string;
  operationId: string;
  mode: typeof ONE_SHOT_REAL_PUBLISH_ACCEPTANCE;
  authenticated: boolean;
  sameCanonicalContext: boolean;
  sameCanonicalPage: boolean;
  mutexOwned: boolean;
  editorPhase: "IMAGE_POST_POST_UPLOAD_EDITOR";
  safeFixtureUploaded: boolean;
  titleReadbackVerified: boolean;
  bodyReadbackVerified: boolean;
  requiredFieldsPass: boolean;
  loginPagePresent: boolean;
  securityVerificationPresent: boolean;
  finalSubmitControl: OneShotFinalSubmitControlEvidence;
}

export interface OneShotConfirmationCandidate {
  candidateId: string;
  modalId: string;
  semanticIntent: string;
  sameModal: boolean;
  unique: boolean;
  visible: boolean;
  enabled: boolean;
  hitTestValid: boolean;
}

export interface OneShotPublicationGuardHooks {
  onConsumed?: (authorization: OneShotPublicationAuthorization) => void | boolean | Promise<void | boolean>;
  onFinalMousePressDispatchStarted?: (authorization: OneShotPublicationAuthorization) => void | boolean | Promise<void | boolean>;
  onSubmissionReconciliationRequired?: (authorization: OneShotPublicationAuthorization) => void | boolean | Promise<void | boolean>;
  onConfirmationCommit?: (authorization: OneShotPublicationAuthorization) => void | boolean | Promise<void | boolean>;
}

export class OneShotPublicationGuardError extends Error {
  constructor(readonly code: "ONE_SHOT_AUTHORIZATION_BINDING_MISMATCH" | "FINAL_SUBMIT_PREFLIGHT_FAILED" | "FINAL_SUBMIT_ALREADY_USED" | "PUBLICATION_COMMIT_ACTION_LIMIT" | "CONFIRMATION_MODAL_NOT_VERIFIED" | "AUTHORIZATION_CONSUMPTION_FAILED", message = code) {
    super(message);
    this.name = "OneShotPublicationGuardError";
  }
}

export function createOwnerAuthorizedOneShotPublication(input: {
  platformKey: string;
  accountId: string;
  operationId: string;
  mode: string;
}): OneShotPublicationAuthorization {
  if (input.platformKey !== "xiaohongshu" || !input.accountId.trim() || input.mode !== ONE_SHOT_REAL_PUBLISH_ACCEPTANCE || !input.operationId.trim()) {
    throw new OneShotPublicationGuardError("ONE_SHOT_AUTHORIZATION_BINDING_MISMATCH");
  }
  return {
    authorization: OWNER_AUTHORIZED_ONE_SHOT_TEST_PUBLISH,
    state: "AUTHORIZED_UNUSED",
    platformKey: "xiaohongshu",
    accountId: input.accountId,
    operationId: input.operationId,
    mode: ONE_SHOT_REAL_PUBLISH_ACCEPTANCE,
    publicationTransactionCount: 0,
    publicationCommitActionCount: 0,
    finalSubmitAttemptCount: 0,
    finalSubmitRetryCount: 0,
    finalSubmitActionStarted: false,
    finalSubmitActionCompleted: false,
    consumedAt: null
  };
}

function ensureAuthorizationBinding(authorization: OneShotPublicationAuthorization, preflight: OneShotFinalSubmitPreflight): void {
  const matches = authorization.authorization === OWNER_AUTHORIZED_ONE_SHOT_TEST_PUBLISH
    && authorization.platformKey === "xiaohongshu"
    && authorization.accountId.trim().length > 0
    && authorization.mode === ONE_SHOT_REAL_PUBLISH_ACCEPTANCE
    && authorization.operationId === preflight.operationId
    && preflight.authorization === authorization.authorization
    && preflight.platformKey === authorization.platformKey
    && preflight.accountId === authorization.accountId
    && preflight.mode === authorization.mode;
  if (!matches) throw new OneShotPublicationGuardError("ONE_SHOT_AUTHORIZATION_BINDING_MISMATCH");
}

function ensurePreflight(authorization: OneShotPublicationAuthorization, preflight: OneShotFinalSubmitPreflight): void {
  ensureAuthorizationBinding(authorization, preflight);
  const control = preflight.finalSubmitControl;
  const valid = preflight.authorizationState === "AUTHORIZED_UNUSED"
    && preflight.authenticated
    && preflight.sameCanonicalContext
    && preflight.sameCanonicalPage
    && preflight.mutexOwned
    && preflight.editorPhase === "IMAGE_POST_POST_UPLOAD_EDITOR"
    && preflight.safeFixtureUploaded
    && preflight.titleReadbackVerified
    && preflight.bodyReadbackVerified
    && preflight.requiredFieldsPass
    && !preflight.loginPagePresent
    && !preflight.securityVerificationPresent
    && control.status === "FOUND_UNIQUE"
    && control.visible
    && control.enabled
    && control.hitTestValid;
  if (!valid) throw new OneShotPublicationGuardError("FINAL_SUBMIT_PREFLIGHT_FAILED");
}

function confirmationIntentIsClear(candidate: OneShotConfirmationCandidate): boolean {
  return /确认发布|继续发布|confirm\s*publish/iu.test(candidate.semanticIntent.trim());
}

export class OneShotPublicationGuard {
  private current: OneShotPublicationAuthorization;

  constructor(authorization: OneShotPublicationAuthorization, private readonly hooks: OneShotPublicationGuardHooks = {}) {
    this.current = { ...authorization };
  }

  get authorization(): OneShotPublicationAuthorization {
    return { ...this.current };
  }

  async startFinalSubmit<T>(preflight: OneShotFinalSubmitPreflight, action: () => Promise<T>, options: { deferDispatchLock?: boolean } = {}): Promise<T> {
    if (this.current.state !== "AUTHORIZED_UNUSED" || this.current.finalSubmitAttemptCount >= MAX_FINAL_SUBMIT_ATTEMPTS || this.current.publicationTransactionCount >= MAX_PUBLICATION_TRANSACTIONS || this.current.finalSubmitRetryCount !== FINAL_SUBMIT_RETRY_COUNT) {
      throw new OneShotPublicationGuardError("FINAL_SUBMIT_ALREADY_USED");
    }
    ensurePreflight(this.current, preflight);
    const previous = this.current;
    this.current = {
      ...this.current,
      state: "ARMED"
    };
    if (!options.deferDispatchLock) await this.beginFinalMousePress();
    try {
      return await action();
    } catch (error) {
      if (this.current.state === "ARMED") this.current = previous;
      throw error;
    }
  }

  async beginFinalMousePress(): Promise<OneShotPublicationAuthorization> {
    if (this.current.state !== "ARMED" || this.current.finalSubmitAttemptCount >= MAX_FINAL_SUBMIT_ATTEMPTS || this.current.publicationTransactionCount >= MAX_PUBLICATION_TRANSACTIONS) {
      throw new OneShotPublicationGuardError("FINAL_SUBMIT_ALREADY_USED");
    }
    const started: OneShotPublicationAuthorization = {
      ...this.current,
      state: this.hooks.onFinalMousePressDispatchStarted ? "FINAL_MOUSEPRESS_DISPATCH_STARTED" : "CONSUMED",
      publicationTransactionCount: 1,
      publicationCommitActionCount: 1,
      finalSubmitAttemptCount: 1,
      finalSubmitRetryCount: FINAL_SUBMIT_RETRY_COUNT,
      finalSubmitActionStarted: true,
      consumedAt: new Date().toISOString()
    };
    const persisted = this.hooks.onFinalMousePressDispatchStarted
      ? await this.hooks.onFinalMousePressDispatchStarted(started)
      : await this.hooks.onConsumed?.(started);
    if (persisted === false) throw new OneShotPublicationGuardError("AUTHORIZATION_CONSUMPTION_FAILED");
    this.current = started;
    return this.authorization;
  }

  hasFinalMousePressStarted(): boolean {
    return this.current.state === "FINAL_MOUSEPRESS_DISPATCH_STARTED" || this.current.state === "SUBMIT_RECONCILIATION_REQUIRED" || this.current.state === "CONSUMED" || this.current.state === "COMPLETED";
  }

  async markSubmissionReconciliationRequired(): Promise<OneShotPublicationAuthorization> {
    if (this.current.state !== "FINAL_MOUSEPRESS_DISPATCH_STARTED") return this.authorization;
    const pending: OneShotPublicationAuthorization = { ...this.current, state: "SUBMIT_RECONCILIATION_REQUIRED" };
    const persisted = await this.hooks.onSubmissionReconciliationRequired?.(pending);
    if (persisted === false) throw new OneShotPublicationGuardError("AUTHORIZATION_CONSUMPTION_FAILED");
    this.current = pending;
    return this.authorization;
  }

  async confirmModal<T>(candidate: OneShotConfirmationCandidate, action: () => Promise<T>): Promise<T> {
    if (!["CONSUMED", "FINAL_MOUSEPRESS_DISPATCH_STARTED"].includes(this.current.state) || this.current.publicationTransactionCount !== 1 || this.current.finalSubmitAttemptCount !== 1) {
      throw new OneShotPublicationGuardError("FINAL_SUBMIT_ALREADY_USED");
    }
    if (this.current.publicationCommitActionCount >= MAX_PUBLICATION_COMMIT_ACTIONS) throw new OneShotPublicationGuardError("PUBLICATION_COMMIT_ACTION_LIMIT");
    if (!candidate.sameModal || !candidate.unique || !candidate.visible || !candidate.enabled || !candidate.hitTestValid || !confirmationIntentIsClear(candidate)) {
      throw new OneShotPublicationGuardError("CONFIRMATION_MODAL_NOT_VERIFIED");
    }
    const confirmed: OneShotPublicationAuthorization = { ...this.current, publicationCommitActionCount: 2 };
    const persisted = await this.hooks.onConfirmationCommit?.(confirmed);
    if (persisted === false) throw new OneShotPublicationGuardError("AUTHORIZATION_CONSUMPTION_FAILED");
    this.current = confirmed;
    return action();
  }

  markFinalSubmitCompleted(): OneShotPublicationAuthorization {
    const state = this.current.state === "FINAL_MOUSEPRESS_DISPATCH_STARTED" || this.current.state === "SUBMIT_RECONCILIATION_REQUIRED"
      ? "COMPLETED"
      : this.current.state;
    this.current = { ...this.current, state, finalSubmitActionCompleted: true };
    return this.authorization;
  }
}

export interface OneShotPostSubmitObservation {
  urlChanged: boolean;
  successToast: boolean;
  editorExited: boolean;
  successPage: boolean;
  creatorContentMatched: "YES" | "NO" | "UNKNOWN";
  platformError: string | null;
}

export type OneShotPostSubmitStatus = "PUBLISHED_VERIFIED" | "NEEDS_RECONCILIATION" | "PLATFORM_REJECTED";

export function classifyOneShotPostSubmitObservation(observation: OneShotPostSubmitObservation): OneShotPostSubmitStatus {
  if (observation.platformError || observation.creatorContentMatched === "NO") return "PLATFORM_REJECTED";
  const successEvidence = observation.creatorContentMatched === "YES"
    || (observation.urlChanged && observation.successPage)
    || (observation.successToast && observation.editorExited);
  return successEvidence ? "PUBLISHED_VERIFIED" : "NEEDS_RECONCILIATION";
}

export function reconcileOneShotPublication(input: {
  titleMatch: boolean;
  accountMatch: boolean;
  timeWindowMatch: boolean;
  thumbnailMatch: boolean;
  externalId?: string;
  publishedUrl?: string;
}): { reconciled: boolean; status: "Published" | "NeedsReconciliation"; externalId?: string; publishedUrl?: string } {
  const reconciled = input.titleMatch && input.accountMatch && input.timeWindowMatch && input.thumbnailMatch && Boolean(input.externalId?.trim()) && Boolean(input.publishedUrl?.trim());
  return {
    reconciled,
    status: reconciled ? "Published" : "NeedsReconciliation",
    ...(input.externalId?.trim() ? { externalId: input.externalId.trim() } : {}),
    ...(input.publishedUrl?.trim() ? { publishedUrl: input.publishedUrl.trim() } : {})
  };
}
