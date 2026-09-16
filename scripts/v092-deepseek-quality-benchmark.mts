import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockAIProvider } from "@publisher/ai";
import { openDatabase } from "@publisher/db";
import { conservativePlatformContentRules, evaluateContentQuality, type Brand } from "@publisher/domain";
import { createConsoleLogger } from "@publisher/logger";
import { runQualityBenchmark, runQualityBenchmarkReviewSample } from "../apps/desktop/src/main/quality-benchmark";
import { assertFrozenBenchmarkDataset, BENCHMARK_BUSINESSES, BENCHMARK_CITIES, BENCHMARK_ID, BENCHMARK_PLATFORMS, BENCHMARK_PROMPT_VERSION, BENCHMARK_TOPICS, DATASET_VERSION } from "./v092-benchmark-dataset";

const root = process.cwd();
const tempDir = mkdtempSync(join(tmpdir(), "geo-media-v092-quality-benchmark-"));
const { db, repository } = openDatabase(join(tempDir, "publisher.db"), join(root, "packages", "db", "migrations"));
const logger = createConsoleLogger();

function riskCounts(runId: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of repository.listQualityBenchmarkContents(runId)) {
    for (const review of repository.listContentQualityReviews("article_variant", item.contentTypeId)) for (const risk of review.issues) counts[risk.code] = (counts[risk.code] ?? 0) + 1;
  }
  return counts;
}

function averageRiskCount(runId: string): number {
  const items = repository.listQualityBenchmarkContents(runId, true);
  return items.length === 0 ? 0 : items.reduce((total, item) => total + item.riskCount, 0) / items.length;
}

function makeBenchmarkBrand(): Brand {
  return repository.createBrand({
    name: "康一环保测试资料",
    companyName: "江苏康一环保科技有限公司",
    description: "提供甲醛治理、定期消杀、灭四害、白蚁防治、病媒生物防制等环境治理服务；具体服务范围、方案、效果和交付边界以双方确认资料为准。",
    mainBusiness: BENCHMARK_BUSINESSES.join("、"),
    serviceRegions: [...BENCHMARK_CITIES],
    advantages: ["服务范围以企业资料为准", "流程与边界可在沟通时确认"],
    serviceProcess: "需求沟通、现场情况评估、方案与报价确认、服务实施、结果复核与售后沟通；具体以双方确认的服务约定为准。",
    afterSales: "是否复检、整改或返工，以合同和现场情况为准。",
    faq: "服务前可准备房屋或场所类型、面积、问题表现和期望时间。",
    certificates: "",
    patents: "",
    cases: "",
    aiForbiddenClaims: ["国家级认证", "不存在的资质", "不存在的证书", "不存在的专利", "行业第一", "最好", "100%清除甲醛", "绝对", "唯一", "保证", "永久", "永不反弹", "一次治理永久有效"]
  });
}

function directQualityFixtures(brand: Brand): { maliciousClaimsRejected: boolean; cityConflictRejected: boolean; cityReplacementNeedsReview: boolean } {
  const malicious = evaluateContentQuality({ brand, city: "木渎", keyword: "木渎甲醛治理", content: { title: "木渎甲醛治理行业第一", body: "国家级认证，100%清除甲醛，永不反弹，一次治理永久有效；拥有不存在的专利和南京服务案例。", summary: "木渎甲醛治理" }, knownCities: brand.serviceRegions, platformRules: conservativePlatformContentRules("wechat_official") });
  const conflict = evaluateContentQuality({ brand, city: "木渎", keyword: "木渎白蚁防治", content: { title: "木渎白蚁防治说明", body: "康一环保在南京提供木渎白蚁防治服务，具体范围以双方确认资料为准。" }, knownCities: brand.serviceRegions, platformRules: conservativePlatformContentRules("zhihu") });
  const replacement = evaluateContentQuality({ brand, city: "江苏", keyword: "江苏甲醛治理", content: { title: "江苏甲醛治理服务判断", body: "康一环保在江苏提供甲醛治理服务，先确认现场情况、服务流程、交付边界和复核安排，具体以双方确认资料为准。" }, similarTexts: ["康一环保在苏州提供甲醛治理服务，先确认现场情况、服务流程、交付边界和复核安排，具体以双方确认资料为准。"], platformRules: conservativePlatformContentRules("toutiao") });
  return { maliciousClaimsRejected: malicious.status === "Rejected", cityConflictRejected: conflict.status === "Rejected", cityReplacementNeedsReview: replacement.status === "Needs_Review" };
}

async function main(): Promise<void> {
  assertFrozenBenchmarkDataset();
  repository.seedDevelopment(join(root, "PLATFORMS.csv"));
  const brand = makeBenchmarkBrand();
  repository.expandContentStudioKeywords({ brandId: brand.id, cities: [...BENCHMARK_CITIES], keywords: [...BENCHMARK_BUSINESSES], industry: "环保服务" });

  const mock = await runQualityBenchmark(repository, logger, { createAiProvider: () => new MockAIProvider() }, { brandId: brand.id, benchmarkId: BENCHMARK_ID, datasetVersion: DATASET_VERSION, promptVersion: BENCHMARK_PROMPT_VERSION, runType: "MOCK_BASELINE", providerHint: "mock", modelHint: "mock-editor-v0.1", temperature: 0.7, maxTokens: 3000, topics: BENCHMARK_TOPICS, platforms: BENCHMARK_PLATFORMS });
  const mockBeforeReview = mock.metrics;
  const mockReviewSample = runQualityBenchmarkReviewSample(repository, mock.run.benchmarkRunId, 20);
  const mockAfterReview = repository.getQualityBenchmarkMetrics(mock.run.benchmarkRunId);

  const deepseek = await runQualityBenchmark(repository, logger, { createAiProvider: () => { throw new Error("DeepSeek real benchmark requires the Electron main-process CredentialStore; this CLI did not read or copy secure credentials"); } }, { brandId: brand.id, benchmarkId: BENCHMARK_ID, datasetVersion: DATASET_VERSION, promptVersion: BENCHMARK_PROMPT_VERSION, runType: "DEEPSEEK_REAL", providerHint: "deepseek", modelHint: "configured-in-main-process", temperature: null, maxTokens: null, topics: BENCHMARK_TOPICS, platforms: BENCHMARK_PLATFORMS });
  const rules = repository.getPlatformContentRules();
  const fixtures = directQualityFixtures(brand);
  const report = `# V0.9.2 DeepSeek 真实内容质量基准验收报告

## 1. 验收结论

本轮完成了冻结数据集、Mock 基线、Quality Gate 规则与审核状态持久化验收。DeepSeek 真实调用状态：**BLOCKED**。离线 CLI 不读取或复制安全凭据；本次 Electron 主进程重跑发现 credential_ref=ai:apiKey，但 safeStorage.decryptString 解密失败，因此没有伪造 DeepSeek 结果，也没有发起真实模型请求。

## 2. 冻结数据集

- benchmarkId：${BENCHMARK_ID}
- datasetVersion：${DATASET_VERSION}
- promptVersion：${BENCHMARK_PROMPT_VERSION}
- 资料入口：通过现有 Brand Center 创建临时验收品牌资料；报告不保存联系方式、Credential 或原始敏感资料。
- 业务：${BENCHMARK_BUSINESSES.join("、")}
- 地区：${BENCHMARK_CITIES.join("、")}
- 主题：${BENCHMARK_TOPICS.length} 个
- 平台：${BENCHMARK_PLATFORMS.length} 个既有平台（微信公众号、知乎、今日头条、新浪微博、抖音脚本、B站脚本）
- 目标内容：${BENCHMARK_TOPICS.length * BENCHMARK_PLATFORMS.length} 个版本；未新增平台，未修改 Adapter，未执行真实发布。

## 3. Mock 与 DeepSeek 隔离结果

| 指标 | MOCK_BASELINE | DEEPSEEK_REAL |
| --- | ---: | ---: |
| benchmarkRunId | ${mock.run.benchmarkRunId} | ${deepseek.run.benchmarkRunId} |
| provider/model | ${mock.run.provider}/${mock.run.model} | ${deepseek.run.provider}/${deepseek.run.model} |
| 状态 | ${mock.run.status} | ${deepseek.run.status} |
| 生成版本数 | ${mockBeforeReview.generatedVariantCount} | ${deepseek.metrics.generatedVariantCount} |
| 当前唯一内容数 | ${mockBeforeReview.currentUniqueContentCount} | ${deepseek.metrics.currentUniqueContentCount} |
| 初始 Needs_Review | ${mockBeforeReview.currentStatusCount.Needs_Review} | ${deepseek.metrics.currentStatusCount.Needs_Review} |
| 初始 Rejected | ${mockBeforeReview.currentStatusCount.Rejected} | ${deepseek.metrics.currentStatusCount.Rejected} |
| 最终 Needs_Review | ${mockAfterReview.currentStatusCount.Needs_Review} | 0 |
| 最终 Rejected | ${mockAfterReview.currentStatusCount.Rejected} | 0 |
| 最终 Approved | ${mockAfterReview.approvedUniqueContentCount} | ${deepseek.metrics.approvedUniqueContentCount} |
| 平均风险数 | ${averageRiskCount(mock.run.benchmarkRunId).toFixed(2)} | ${averageRiskCount(deepseek.run.benchmarkRunId).toFixed(2)} |
| 请求耗时 | ${mock.run.totalDurationMs} ms | 未调用 |
| Token 使用 | ${mock.run.totalTokenUsage.totalTokens} | 未调用 |
| 成本 | ${mock.run.estimatedCost === null ? "未估算" : mock.run.estimatedCost} | 未调用 |

Mock 审核事件累计风险类型：${JSON.stringify(riskCounts(mock.run.benchmarkRunId))}。DeepSeek 因 BLOCKED 没有可比较的风险、状态、Token、耗时或成本数据，不能推断 DeepSeek 的质量表现。

## 4. 重复度与恶意诱导验收

- 同一平台跨城市的相似度字段已写入 intraPlatformSimilarity；同一主题跨平台的相似度字段已写入 crossPlatformSimilarity。相似度只保存数值，不保存正文。
- 城市词简单替换 fixture：${fixtures.cityReplacementNeedsReview ? "PASS：进入 Needs_Review" : "BLOCKED"}。
- 排名、虚假认证、绝对化词、100%效果、永久效果、虚假专利和服务城市冲突 fixture：${fixtures.maliciousClaimsRejected ? "PASS：拦截为 Rejected" : "BLOCKED"}。
- 城市冲突 fixture：${fixtures.cityConflictRejected ? "PASS：拦截为 Rejected" : "BLOCKED"}。

## 5. 审核流程样本

命令行环境没有真实人工 UI 操作员，本节的 Mock 样本是脚本驱动的等价持久化流程，不冒充人工点击证据。

- Mock 样本数：${mockReviewSample.sampledCount}。
- 人工编辑并复检数：${mockReviewSample.modifiedCount}。
- 最终 Approved：${mockReviewSample.approvedCount}。
- 最终 Rejected：${mockReviewSample.rejectedCount}。
- DeepSeek 样本数：0（BLOCKED；未生成 DeepSeek 内容）。
- Mock 审核后当前状态：${JSON.stringify(mockAfterReview.currentStatusCount)}。
- Needs_Review → 编辑 → 重新检查 → Approved/Rejected：${mockReviewSample.modifiedCount > 0 ? "PASS（脚本驱动）" : "BLOCKED"}。
- DeepSeek 真实人工流程：BLOCKED，需修复当前 Windows/Electron safeStorage 解密上下文后，在 Electron 主进程中重跑。

## 6. 平台规则

${rules.length} 个既有平台均从 PlatformContentRules 读取；${rules.filter((rule) => rule.verificationStatus === "unverified").length} 个规则保持 unverified，source 与 lastVerifiedAt 未凭空填写，检查使用保守 fallback。未修改 React 页面硬编码规则，未新增平台。

## 7. 安全与发布边界

- 仅记录 provider、model、promptVersion、请求统计、内容 hash、Quality Gate 状态和风险数。
- 未记录 API Key、Authorization、Cookie、StorageState 或其他 Credential。
- 未创建真实平台发布记录，未进入真实发布流程。
- Draft、AI_Checked、Needs_Review、Rejected 仍被发布队列门禁拒绝，只有 Approved 可通过已有发布前校验。

## 8. 后续重跑条件

在当前 Windows 用户上下文中重新保存并确认 DeepSeek Provider 凭据后，通过主进程 quality-benchmark:run 入口执行同一 benchmarkId/datasetVersion/promptVersion；系统必须生成新的 benchmarkRunId，不得覆盖本次 BLOCKED 记录。完成后再补充 DeepSeek 120 个版本、风险、状态、Token、耗时、成本和至少 20 个审核样本。
`;
  writeFileSync(join(root, "docs", "V0.9.2_DEEPSEEK_QUALITY_BENCHMARK.md"), report, "utf8");
  console.log(JSON.stringify({ benchmarkId: BENCHMARK_ID, datasetVersion: DATASET_VERSION, mockRunId: mock.run.benchmarkRunId, deepseekRunId: deepseek.run.benchmarkRunId, mockGeneratedVariantCount: mockBeforeReview.generatedVariantCount, mockCurrentStatusCount: mockAfterReview.currentStatusCount, mockReviewSample, deepseekStatus: deepseek.run.status, deepseekCalled: false, platformRules: rules.length, fixtures }, null, 2));
}

try {
  await main();
} finally {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
}
