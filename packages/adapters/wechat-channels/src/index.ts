import type { ErrorCode } from "@publisher/domain";
import { ManualOnlyAdapter, mapManualError, type ManualAdapterDefinition } from "@publisher/adapters-manual";

const definition: ManualAdapterDefinition = {
  platformKey: "wechat_channels",
  displayName: "视频号",
  category: "视频",
  officialWebsite: "https://channels.weixin.qq.com/",
  officialSources: ["https://channels.weixin.qq.com/"],
  blockingReason: "当前仅确认视频号助手人工投稿，未确认公开作品写入与状态回查 API；不自动化微信页面",
  researchStatus: "manual_only",
  status: "ManualOnly",
  supportsArticle: false,
  supportsVideo: true,
  credentials: [{ key: "browserLogin", label: "视频号助手登录", type: "browser_login", required: true }],
  capabilities: { article: false, imagePost: false, video: true, coverImage: true, tags: true, categories: false, scheduledPublish: false, draft: true, markdown: false, richText: false, maxTitleLength: 100, maxImageCount: 0, maxTagCount: 10, maxVideoSize: 1024 * 1024 * 1024, supportsVideoCover: true, supportsVideoTags: true, videoPublishAsync: false },
  manualInstructions: "打开视频号助手，完成登录和安全验证后人工上传视频、填写标题并确认发布。"
};

export function mapWechatChannelsError(message: string, httpStatus?: number): ErrorCode { return mapManualError(message, httpStatus); }
export class WechatChannelsAdapter extends ManualOnlyAdapter { constructor() { super(definition); } }
export const WeChatChannelsAdapter = WechatChannelsAdapter;
export default WechatChannelsAdapter;
