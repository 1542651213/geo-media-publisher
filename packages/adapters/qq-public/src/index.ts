import type { ErrorCode } from "@publisher/domain";
import { ManualOnlyAdapter, mapManualError, type ManualAdapterDefinition } from "@publisher/adapters-manual";

const definition: ManualAdapterDefinition = {
  platformKey: "qq_public",
  displayName: "企鹅号",
  category: "图文/内容",
  officialWebsite: "https://om.qq.com/",
  officialSources: ["https://om.qq.com/"],
  blockingReason: "官方开发者接入和第三方发布资质当前未完成确认，不能把历史能力或后台页面当作可调用 API",
  researchStatus: "partial",
  status: "Blocked",
  supportsArticle: true,
  supportsVideo: false,
  credentials: [{ key: "browserLogin", label: "企鹅号官方后台登录", type: "browser_login", required: true }],
  capabilities: { article: true, imagePost: true, video: false, coverImage: true, tags: true, categories: true, scheduledPublish: false, draft: true, markdown: false, richText: true, maxTitleLength: 100, maxImageCount: 9, maxTagCount: 10, supportsVideoCover: false, supportsVideoTags: false, videoPublishAsync: false },
  manualInstructions: "打开企鹅号官方后台，完成登录和平台验证后人工编辑、上传并提交内容。"
};

export function mapQqPublicError(message: string, httpStatus?: number): ErrorCode { return mapManualError(message, httpStatus); }
export class QqPublicAdapter extends ManualOnlyAdapter { constructor() { super(definition); } }
export const PenguinAdapter = QqPublicAdapter;
export default QqPublicAdapter;
