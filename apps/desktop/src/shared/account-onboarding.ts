import type { OperationsRuntimeAuthState } from "./content-operations";

export const ACCOUNT_ONBOARDING_EVIDENCE_STATES = ["Unique", "Conflict", "NoEvidence", "Confirmed"] as const;
export type AccountOnboardingEvidenceState = typeof ACCOUNT_ONBOARDING_EVIDENCE_STATES[number];

export interface AccountOnboardingSource {
  jobId: string;
  articleId: string;
  brandId: string;
}

/** Safe source references and counts only. Historical usage does not prove a successful publish. */
export interface AccountOnboardingEvidence {
  companyId: string;
  companyName: string;
  source: "HistoricalJobArticleBrand";
  jobCount: number;
  articleCount: number;
  brandCount: number;
  sources: AccountOnboardingSource[];
}

export type AccountBindingBlockerCode = "ACTIVE_PUBLISH_JOB" | "UNRESOLVED_PUBLISH_JOB" | "FROZEN_SUBMISSION_INTENT" | "FROZEN_PUBLISH_RECORD"
  | "FROZEN_TOUTIAO_PREPARATION" | "FROZEN_TOUTIAO_FINAL_BINDING" | "FROZEN_DOUYIN_JOB"
  | "ACTIVE_DOUYIN_CONNECTION" | "FROZEN_B01_AUTHORIZATION" | "FROZEN_WEBSITE_OPERATION";

export interface AccountBindingBlocker {
  code: AccountBindingBlockerCode;
  count: number;
  summary: string;
}

export interface AccountOnboardingAccount {
  accountId: string;
  platformKey: string;
  accountName: string;
  enabled: boolean;
  archived: boolean;
  currentCompanyId: string | null;
  currentCompanyName: string | null;
  currentBindingVersion: number;
  evidenceState: AccountOnboardingEvidenceState;
  suggestedCompanyId: string | null;
  suggestedCompanyName: string | null;
  evidence: AccountOnboardingEvidence[];
  evidenceSummary: string;
  conflictReason: string | null;
  verificationState: OperationsRuntimeAuthState;
  checkedAt: string | null;
  platformOrdinaryEnabled: boolean;
  articlePublishEligibility: "NotEvaluated";
  /** Initial assignment uses active-job blockers; existing bindings expose blockers for changing company. */
  bindingBlockers: AccountBindingBlocker[];
  /** Initial assignment or same-company reconfirmation; same-company reconfirmation never changes the binding. */
  canConfirm: boolean;
  /** Changing an already confirmed company additionally requires an explicit Owner reassignment flag. */
  canReassign: boolean;
  nextAction: string;
}

/** Every account has an explicit mapping and the version/company that the Owner actually reviewed. */
export interface AccountOnboardingConfirmation {
  accountId: string;
  companyId: string;
  expectedVersion: number;
  expectedCompanyId: string | null;
  confirmReassignment?: boolean;
}

export interface AccountOnboardingConfirmationResult {
  accountId: string;
  platformKey: string;
  companyId: string;
  previousCompanyId: string | null;
  bindingVersion: number;
  authenticated: false;
  verificationState: "UNVERIFIED";
  requiresIdentityVerification: true;
}

export interface AccountOnboardingApi {
  preview(): Promise<AccountOnboardingAccount[]>;
  confirm(input: AccountOnboardingConfirmation): Promise<AccountOnboardingConfirmationResult>;
}
