import type { PublishFlowExplorationInput, PublishFlowExplorationResult } from "@publisher/adapters-core";

export const XHS_TASK10S_FRESH_PUBLISH_FLOW_FLAG = "--xhs-task10s-fresh-publish-flow" as const;
export const RUN_XHS_TASK10S_FRESH_PUBLISH_FLOW = "RUN_XHS_TASK10S_FRESH_PUBLISH_FLOW" as const;
export const XHS_TASK10S_FRESH_PUBLISH_FLOW_TITLE = "自动化发布测试1｜请忽略" as const;
export const XHS_TASK10S_FRESH_PUBLISH_FLOW_BODY = "GEO Media Publisher 自动发布链路测试。" as const;

export interface Task10sFreshPublishFlowResult {
  action: typeof RUN_XHS_TASK10S_FRESH_PUBLISH_FLOW;
  status: PublishFlowExplorationResult["status"];
  operationId: string;
  /** Explicit L5 run this evidence was collected for. Null means it cannot arm a run. */
  testRunId: string | null;
  accountId: string | null;
  newPublishEntry: "PASS" | "FAIL" | "NOT_RUN";
  identityAttestation: {
    status: "PASS" | "BLOCKED";
    creatorId: string | null;
    contextId: string | null;
    failureCode: string | null;
  };
  fixture: {
    path: string;
    expectedName: string;
    expectedSizeBytes: number;
    expectedSha256: string;
    valid: boolean;
    failureCode: string | null;
  };
  fixedContent: {
    title: typeof XHS_TASK10S_FRESH_PUBLISH_FLOW_TITLE;
    body: typeof XHS_TASK10S_FRESH_PUBLISH_FLOW_BODY;
  };
  exploration: PublishFlowExplorationResult | null;
  readyForFinalSubmit: boolean;
  safety: {
    uploadAttempts: number;
    titleMutationCount: number;
    bodyMutationCount: number;
    finalSubmitCount: 0;
    publicationTransactionCount: 0;
    newAuthorizationCreated: 0;
  };
  failureCode: string | null;
}

export interface Task10sFreshPublishFlowReadiness {
  identityVerified: boolean;
  newPublishEntryPass: boolean;
  uploadProofPass: boolean;
  titleReadbackExact: boolean;
  bodyReadbackExact: boolean;
  finalPublishButtonMatchCount: number;
  finalPublishEnabled: boolean;
  finalSubmitCount: number;
}

export function isTask10sFreshPublishFlowReady(input: Task10sFreshPublishFlowReadiness): boolean {
  return input.identityVerified
    && input.newPublishEntryPass
    && input.uploadProofPass
    && input.titleReadbackExact
    && input.bodyReadbackExact
    && input.finalPublishButtonMatchCount === 1
    && input.finalPublishEnabled
    && input.finalSubmitCount === 0;
}

export function buildTask10sFreshPublishFlowInput(imagePath: string, operationId: string): PublishFlowExplorationInput {
  return {
    imagePath,
    imageSource: "SAFE_TEST_FIXTURE",
    title: XHS_TASK10S_FRESH_PUBLISH_FLOW_TITLE,
    body: XHS_TASK10S_FRESH_PUBLISH_FLOW_BODY,
    operationId,
    postUploadReadinessStrategy: "TERMINAL_CLASSIFIER",
    budgets: {
      maxDurationMs: 60_000,
      maxNavigationRestarts: 0,
      maxUploadAttempts: 1,
      maxIntermediateActionClicks: 1,
      maxRefreshCount: 0,
      maxTitleMutations: 1,
      maxBodyMutations: 1
    }
  };
}

export function isTask10sFreshPublishStartPath(pathname: string): boolean {
  return pathname === "/" || pathname === "/new/home";
}

export function blockedTask10sFreshPublishFlowResult(input: {
  operationId: string;
  testRunId?: string | null;
  accountId?: string | null;
  failureCode: string;
  fixture?: Task10sFreshPublishFlowResult["fixture"];
  identityAttestation?: Task10sFreshPublishFlowResult["identityAttestation"];
}): Task10sFreshPublishFlowResult {
  return {
    action: RUN_XHS_TASK10S_FRESH_PUBLISH_FLOW,
    status: "BLOCKED",
    operationId: input.operationId,
    testRunId: input.testRunId ?? null,
    accountId: input.accountId ?? null,
    newPublishEntry: "NOT_RUN",
    identityAttestation: input.identityAttestation ?? { status: "BLOCKED", creatorId: null, contextId: null, failureCode: input.failureCode },
    fixture: input.fixture ?? { path: "", expectedName: "task10s-safe-test.png", expectedSizeBytes: 19226, expectedSha256: "15E13943897E9D5A781F781C674BCBA0F5DA5E6DF5C696B961CB4F0F3B38A646", valid: false, failureCode: input.failureCode },
    fixedContent: { title: XHS_TASK10S_FRESH_PUBLISH_FLOW_TITLE, body: XHS_TASK10S_FRESH_PUBLISH_FLOW_BODY },
    exploration: null,
    readyForFinalSubmit: false,
    safety: { uploadAttempts: 0, titleMutationCount: 0, bodyMutationCount: 0, finalSubmitCount: 0, publicationTransactionCount: 0, newAuthorizationCreated: 0 },
    failureCode: input.failureCode
  };
}
