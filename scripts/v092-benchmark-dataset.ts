import { CONTENT_STUDIO_PLATFORM_KEYS, type ContentStudioPlatformKey } from "@publisher/domain";

export const BENCHMARK_ID = "V091_BRAND_QUALITY_001";
export const DATASET_VERSION = "V0.9.2-1.0.0";
export const BENCHMARK_PROMPT_VERSION = "v0.9.2-deepseek-quality-benchmark-v1";

export const BENCHMARK_BUSINESSES = ["甲醛治理", "定期消杀", "灭四害", "白蚁防治", "病媒生物防制"] as const;
export const BENCHMARK_CITIES = ["江苏", "苏州", "木渎"] as const;
export const BENCHMARK_PLATFORMS = [...CONTENT_STUDIO_PLATFORM_KEYS] as ContentStudioPlatformKey[];

export interface BenchmarkTopic {
  index: number;
  title: string;
  city: string;
  keyword: string;
  business: (typeof BENCHMARK_BUSINESSES)[number];
}

export const BENCHMARK_TOPICS: readonly BenchmarkTopic[] = [
  { index: 0, title: "木渎甲醛治理前的现场信息清单", city: "木渎", keyword: "木渎甲醛治理现场评估", business: "甲醛治理" },
  { index: 1, title: "苏州甲醛治理与装修异味处理如何区分", city: "苏州", keyword: "苏州甲醛治理异味处理", business: "甲醛治理" },
  { index: 2, title: "江苏新房甲醛治理的现场评估流程", city: "江苏", keyword: "江苏新房甲醛治理", business: "甲醛治理" },
  { index: 3, title: "木渎甲醛治理后的复检与入住判断", city: "木渎", keyword: "木渎甲醛治理复检", business: "甲醛治理" },
  { index: 4, title: "木渎定期消杀服务前要确认哪些范围", city: "木渎", keyword: "木渎定期消杀范围确认", business: "定期消杀" },
  { index: 5, title: "苏州定期消杀的沟通与执行节点", city: "苏州", keyword: "苏州定期消杀执行节点", business: "定期消杀" },
  { index: 6, title: "江苏办公场所定期消杀需求怎么整理", city: "江苏", keyword: "江苏办公场所定期消杀", business: "定期消杀" },
  { index: 7, title: "木渎定期消杀后的反馈记录怎么留存", city: "木渎", keyword: "木渎定期消杀反馈", business: "定期消杀" },
  { index: 8, title: "木渎灭四害前如何描述现场问题", city: "木渎", keyword: "木渎灭四害现场问题", business: "灭四害" },
  { index: 9, title: "苏州灭四害服务流程与边界说明", city: "苏州", keyword: "苏州灭四害服务流程", business: "灭四害" },
  { index: 10, title: "江苏餐饮场所灭四害沟通清单", city: "江苏", keyword: "江苏餐饮灭四害", business: "灭四害" },
  { index: 11, title: "木渎灭四害后如何进行现场反馈", city: "木渎", keyword: "木渎灭四害现场反馈", business: "灭四害" },
  { index: 12, title: "木渎白蚁防治的现场判断问题", city: "木渎", keyword: "木渎白蚁防治现场判断", business: "白蚁防治" },
  { index: 13, title: "苏州白蚁防治服务如何确认方案", city: "苏州", keyword: "苏州白蚁防治方案确认", business: "白蚁防治" },
  { index: 14, title: "江苏住宅白蚁防治的资料准备", city: "江苏", keyword: "江苏住宅白蚁防治", business: "白蚁防治" },
  { index: 15, title: "木渎白蚁防治后的复核与沟通", city: "木渎", keyword: "木渎白蚁防治复核", business: "白蚁防治" },
  { index: 16, title: "木渎病媒生物防制的需求拆解", city: "木渎", keyword: "木渎病媒生物防制需求", business: "病媒生物防制" },
  { index: 17, title: "苏州病媒生物防制如何看服务边界", city: "苏州", keyword: "苏州病媒生物防制边界", business: "病媒生物防制" },
  { index: 18, title: "江苏公共场所病媒生物防制沟通清单", city: "江苏", keyword: "江苏公共场所病媒生物防制", business: "病媒生物防制" },
  { index: 19, title: "木渎病媒生物防制的过程记录", city: "木渎", keyword: "木渎病媒生物防制记录", business: "病媒生物防制" }
] as const;

export function assertFrozenBenchmarkDataset(): void {
  if (BENCHMARK_TOPICS.length !== 20 || BENCHMARK_PLATFORMS.length !== 6 || new Set(BENCHMARK_TOPICS.map((topic) => topic.index)).size !== 20) throw new Error("V0.9.2 benchmark dataset is not frozen at 20 topics x 6 platforms");
  if (BENCHMARK_TOPICS.some((topic) => !BENCHMARK_CITIES.includes(topic.city as (typeof BENCHMARK_CITIES)[number]) || !BENCHMARK_BUSINESSES.includes(topic.business))) throw new Error("V0.9.2 benchmark dataset contains an unsupported city or business");
}
