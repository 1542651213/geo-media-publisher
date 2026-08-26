import type { ErrorCode } from "@publisher/domain";
import { ManualOnlyAdapter, mapManualError, type ManualAdapterDefinition } from "@publisher/adapters-manual";

const definition: ManualAdapterDefinition = {
  platformKey: "sohu_media",
  displayName: "搜狐号",
  category: "图文/图集/短视频",
  officialWebsite: "https://mp.sohu.com/",
  officialSources: ["https://mp.sohu.com/"],
  blockingReason: "官方页面确认支持图文、图集和短视频创作，但未确认公开第三方写入与状态回查 API",
  researchStatus: "manual_only",
  status: "ManualOnly",
  supportsArticle: true,
  supportsVideo: true,
  credentials: [{ key: "browserLogin", label: "搜狐号创作中心登录", type: "browser_login", required: true }],
  capabilities: { article: true, imagePost: true, video: true, coverImage: true, tags: true, categories: true, scheduledPublish: false, draft: true, markdown: false, richText: true, maxTitleLength: 100, maxImageCount: 9, maxTagCount: 10, maxVideoSize: 1024 * 1024 * 1024, supportsVideoCover: true, supportsVideoTags: true, videoPublishAsync: false },
  manualInstructions: "打开搜狐号创作中心，完成登录、验证码/安全验证后人工上传图文或短视频并确认发布。"
};

export function mapSohuMediaError(message: string, httpStatus?: number): ErrorCode { return mapManualError(message, httpStatus); }
export class SohuMediaAdapter extends ManualOnlyAdapter { constructor() { super(definition); } }
export const SohuOfficialAdapter = SohuMediaAdapter;
export default SohuMediaAdapter;
