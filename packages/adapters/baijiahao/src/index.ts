import type { ErrorCode } from "@publisher/domain";
import { ManualOnlyAdapter, mapManualError, type ManualAdapterDefinition } from "@publisher/adapters-manual";

const definition: ManualAdapterDefinition = {
  platformKey: "baijiahao",
  displayName: "百家号",
  category: "图文/内容",
  officialWebsite: "https://baijiahao.baidu.com/",
  developerPortal: "https://baijiahao.baidu.com/",
  officialSources: ["https://baijiahao.baidu.com/"],
  blockingReason: "当前仅确认官方创作后台人工投稿，未确认公开第三方内容写入与状态回查 API",
  researchStatus: "manual_only",
  status: "ManualOnly",
  supportsArticle: true,
  supportsVideo: false,
  credentials: [{ key: "browserLogin", label: "百家号官方后台登录", type: "browser_login", required: true }],
  capabilities: { article: true, imagePost: true, video: false, coverImage: true, tags: true, categories: true, scheduledPublish: false, draft: true, markdown: false, richText: true, maxTitleLength: 100, maxImageCount: 9, maxTagCount: 10, supportsVideoCover: false, supportsVideoTags: false, videoPublishAsync: false },
  manualInstructions: "打开百家号创作后台，完成登录、验证码/安全验证后手动上传素材并确认发布。"
};

export function mapBaijiahaoError(message: string, httpStatus?: number): ErrorCode { return mapManualError(message, httpStatus); }
export class BaijiahaoAdapter extends ManualOnlyAdapter { constructor() { super(definition); } }
export const BaijiahaoOfficialAdapter = BaijiahaoAdapter;
export default BaijiahaoAdapter;
