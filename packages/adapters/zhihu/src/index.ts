import type { ErrorCode } from "@publisher/domain";
import { ManualOnlyAdapter, mapManualError, type ManualAdapterDefinition } from "@publisher/adapters-manual";

const definition: ManualAdapterDefinition = {
  platformKey: "zhihu",
  displayName: "知乎",
  category: "图文/问答",
  officialWebsite: "https://www.zhihu.com/",
  developerPortal: "https://open.zhihu.com/",
  officialSources: ["https://www.zhihu.com/", "https://open.zhihu.com/"],
  blockingReason: "未确认面向本系统的公开内容写入与状态回查 API；未经官方许可不得自动化知乎创作页面",
  researchStatus: "manual_only",
  status: "ManualOnly",
  supportsArticle: true,
  supportsVideo: false,
  credentials: [{ key: "browserLogin", label: "知乎官方页面登录", type: "browser_login", required: true }],
  capabilities: { article: true, imagePost: true, video: false, coverImage: true, tags: true, categories: false, scheduledPublish: false, draft: true, markdown: false, richText: true, maxTitleLength: 100, maxImageCount: 9, maxTagCount: 10, supportsVideoCover: false, supportsVideoTags: false, videoPublishAsync: false },
  manualInstructions: "打开知乎官方创作页面，完成登录和平台验证后人工编辑、上传并发布。"
};

export function mapZhihuError(message: string, httpStatus?: number): ErrorCode { return mapManualError(message, httpStatus); }
export class ZhihuAdapter extends ManualOnlyAdapter { constructor() { super(definition); } }
export const ZhihuOfficialAdapter = ZhihuAdapter;
export default ZhihuAdapter;
