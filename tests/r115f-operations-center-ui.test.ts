import { rendererSource } from "./renderer-source";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  advanceWorkspaceRequest,
  canonicalStudioTargets,
  factExpiryIso,
  generationProgressPercent,
  initialOperationsUiState,
  isValidGenerationCount,
  isCurrentWorkspaceResponse,
  operationsHealthPresentation,
  operationsPlatformOptions,
  ownerActionCopy,
  planMatchesStatus,
  planDraftBody,
  planStatusLabel,
  preparePlanAndNavigate,
  queueActionAvailability,
  transitionAndRunGenerationQueue,
} from "../apps/desktop/src/renderer/operations-center-ui";

describe("R1.15-F operations center UI safety", () => {
  it("clears company-bound form and selection state when the workspace changes", () => {
    const previous = {
      ...initialOperationsUiState("company-a"),
      selectedReviewId: "review-a",
      selectedPlanId: "plan-a",
      selectedQueueId: "queue-a",
      importFileName: "articles.xlsx",
      queueTopic: "旧企业内容",
      importPreviewReady: true,
    };

    expect(initialOperationsUiState("company-b")).toEqual({
      companyId: "company-b",
      selectedReviewId: "",
      selectedPlanId: "",
      selectedQueueId: "",
      importFileName: "",
      queueTopic: "",
      importPreviewReady: false,
    });
    expect(initialOperationsUiState("company-b")).not.toEqual(previous);
  });

  it("rejects a late response from the previous company workspace", () => {
    const first = advanceWorkspaceRequest(undefined, "company-a");
    const second = advanceWorkspaceRequest(first, "company-b");

    expect(isCurrentWorkspaceResponse(second, first)).toBe(false);
    expect(isCurrentWorkspaceResponse(second, second)).toBe(true);
    expect(second.requestId).toBe(first.requestId + 1);
  });

  it("maps owner blockers to a concise action and explanation", () => {
    expect(ownerActionCopy("WEIBO_LOGIN_REQUIRED")).toEqual({
      what: "登录微博账号",
      why: "微博会话需要 Owner 在平台正常登录后才能继续。",
      action: "前往账号中心",
    });
    expect(ownerActionCopy("PROVIDER_NOT_CONFIGURED").action).toBe("配置 AI 服务商");
    expect(ownerActionCopy("UNRECOGNIZED_BLOCKER").what).toBe("处理账号或任务异常");
  });

  it("only enables queue controls that are valid for the current status", () => {
    expect(queueActionAvailability("RUNNING")).toEqual({ pause: true, resume: false, cancel: true, retryFailed: false });
    expect(queueActionAvailability("PAUSED")).toEqual({ pause: false, resume: true, cancel: true, retryFailed: false });
    expect(queueActionAvailability("FAILED")).toEqual({ pause: false, resume: false, cancel: false, retryFailed: true });
    expect(queueActionAvailability("FAILED", true)).toEqual({ pause: false, resume: false, cancel: false, retryFailed: false });
    expect(queueActionAvailability("COMPLETED")).toEqual({ pause: false, resume: false, cancel: false, retryFailed: false });
  });

  it("runs a resumed or retried queue after the state transition without blocking controls", async () => {
    const calls: string[] = [];
    let releaseRun: (() => void) | undefined;
    const runPending = new Promise<void>(resolve => { releaseRun = resolve; });

    await transitionAndRunGenerationQueue(
      async () => { calls.push("transition"); },
      async () => { calls.push("run"); await runPending; },
    );

    expect(calls).toEqual(["transition", "run"]);
    releaseRun?.();

    const source = rendererSource("OperationsCenter");
    for (const action of ["resumeGenerationQueue", "retryFailedGeneration", "resolveRecoverableGeneration", "resolveValidationGeneration"]) {
      expect(source).toContain(`transitionAndRunGenerationQueue(() => operationsApi().${action}`);
    }
    expect(source).toContain("operationsApi().reconcileGenerationQueue");
    expect(source).toContain("operationsApi().resolveValidationGeneration");
  });

  it("prepares a plan generation before navigating to AI Studio", async () => {
    const calls: string[] = [];
    await preparePlanAndNavigate(
      async () => { calls.push("prepare"); },
      () => { calls.push("navigate"); },
    );
    expect(calls).toEqual(["prepare", "navigate"]);

    const source = rendererSource("OperationsCenter");
    expect(source).toContain("operationsApi().preparePlanGeneration");
    expect(source).not.toContain('disabled={busy || Boolean(row.articleId) || !onNavigate}');
    expect(source).not.toContain("studioPurposes");
    expect(source).not.toContain("<label>用途");
    expect(source).toContain('purpose: "生成文章"');
  });

  it("creates a nonempty fact-neutral plan draft body and enforces the backend count limit", () => {
    expect(planDraftBody("甲醛治理常见问题", "FAQ")).toBe("内容计划：甲醛治理常见问题\n内容类型：FAQ\n\n正文待人工编辑。");
    expect(isValidGenerationCount(1)).toBe(true);
    expect(isValidGenerationCount(20)).toBe(true);
    expect(isValidGenerationCount(21)).toBe(false);
  });

  it("converts a fact expiry date to a valid local end-of-day ISO timestamp", () => {
    expect(factExpiryIso("")).toBeNull();
    const expiresAt = factExpiryIso("2026-10-01");
    expect(expiresAt).not.toBeNull();
    expect(Number.isNaN(Date.parse(expiresAt!))).toBe(false);
    const localExpiry = new Date(expiresAt!);
    expect([localExpiry.getFullYear(), localExpiry.getMonth() + 1, localExpiry.getDate()]).toEqual([2026, 10, 1]);
    expect([localExpiry.getHours(), localExpiry.getMinutes(), localExpiry.getSeconds(), localExpiry.getMilliseconds()]).toEqual([23, 59, 59, 999]);
  });

  it("uses actual source and variant item counts for queue progress", () => {
    const items = [
      { queueId: "queue-a" }, { queueId: "queue-a" }, { queueId: "queue-a" },
      { queueId: "queue-a" }, { queueId: "queue-a" }, { queueId: "queue-a" },
      { queueId: "queue-b" },
    ];
    expect(generationProgressPercent("queue-a", 3, items)).toBe(50);
    expect(generationProgressPercent("queue-a", 8, items)).toBe(100);
    expect(generationProgressPercent("missing", 0, items)).toBe(0);
  });

  it("uses canonical Content Studio platform keys", () => {
    expect(operationsPlatformOptions).toEqual(["douyin", "toutiao", "weibo", "sohu_media", "website", "cnblogs"]);
    expect(operationsPlatformOptions).not.toContain("sohu");
    expect(canonicalStudioTargets(["douyin", "sohu", "sohu_media", "unknown"])).toEqual(["douyin", "sohu_media"]);
  });

  it("presents every product health state as human-readable UI", () => {
    const states = [
      "可发布", "需要登录", "凭据失效", "需要 Owner 操作", "待验收", "只读", "暂未开发", "连接异常",
      "正在验证账号", "已连接", "登录已失效，请重新登录", "凭据已失效，请更新凭据", "暂时无法验证连接",
      "当前登录账号与绑定账号不一致", "尚未验证", "已停用",
    ] as const;
    for (const state of states) {
      const presentation = operationsHealthPresentation(state);
      expect(presentation.label).toBe(state);
      expect(["success", "warning", "danger", "purple", "muted"]).toContain(presentation.tone);
    }
  });

  it("filters plans by the persisted status while showing a human label", () => {
    expect(planMatchesStatus("Planned", "Planned")).toBe(true);
    expect(planMatchesStatus("DraftCreated", "Planned")).toBe(false);
    expect(planMatchesStatus("Archived", "")).toBe(true);
    expect(planStatusLabel("Planned")).toBe("计划中");
    expect(planStatusLabel("DraftCreated")).toBe("已创建草稿");
    expect(planStatusLabel("Archived")).toBe("已归档");
  });

  it("uses live product health and human publish status labels in the operations view", () => {
    const source = rendererSource("OperationsCenter");
    expect(source).toContain("window.publisherAPI.product.health()");
    expect(source).not.toContain("account.loginStatus");
    const jobs = readFileSync("apps/desktop/src/renderer/JobsBoard.tsx", "utf8");
    const ownership = readFileSync("apps/desktop/src/renderer/AccountOwnershipReview.tsx", "utf8");
    expect(jobs).toContain("value={status}>{publishStatusLabel(status)}");
    expect(jobs).toContain("publishStatusLabel(row.status)");
    expect(jobs).toContain("publishStatusTone(row.status)");
    expect(ownership).toContain("platformLabel(item.platformKey)");
  });

  it("exposes the complete draft-only operations workspace without final publish controls", () => {
    const source = rendererSource("OperationsCenter");
    for (const label of ["今日工作台", "内容审核", "草稿生成队列", "内容计划", "事实资料库", "AI 用量", "批量导入", "Owner 处理", "发布看板"]) {
      expect(source).toContain(label);
    }
    expect(source).toContain("导入只创建草稿");
    expect(source).not.toContain("jobs.create");
    expect(source).not.toContain("preparePublish");
    expect(source).not.toContain("confirmPublish");
  });
  it("keeps saved-result reconciliation separate from an explicit remaining-budget run", () => {
    const source = rendererSource("OperationsCenter");
    expect(source).toContain('onAction(() => operationsApi().reconcileGenerationQueue');
    expect(source).not.toContain('transitionAndRunGenerationQueue(() => operationsApi().reconcileGenerationQueue');
    expect(source).toContain('继续剩余预算生成');
    expect(source).toContain('validationBlocked.length > 0 || recoverable.length > 0');
  });


});
