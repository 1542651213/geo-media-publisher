import type { ErrorCode } from "@publisher/domain";
import { ManualOnlyAdapter, mapManualError, type ManualAdapterDefinition } from "@publisher/adapters-manual";

const definition: ManualAdapterDefinition = {
  platformKey: "xiaohongshu",
  displayName: "小红书",
  category: "图文/视频",
  officialWebsite: "https://www.xiaohongshu.com/",
  developerPortal: "https://miniapp.xiaohongshu.com/",
  officialSources: ["https://miniapp.xiaohongshu.com/docs/api-backend/get-api-rmp-session", "https://miniapp.xiaohongshu.com/doc/DC137160"],
  blockingReason: "官方能力是小程序内由用户触发笔记发布；当前没有可用于后台静默发布和回查的公开 API，且新接入资格需平台审核",
  researchStatus: "partial",
  status: "Blocked",
  transport: "official_sdk",
  supportsArticle: true,
  supportsVideo: true,
  credentials: [{ key: "appId", label: "小红书小程序 AppID", type: "text", required: true }, { key: "browserLogin", label: "小红书账号人工确认", type: "browser_login", required: true }],
  capabilities: { article: true, imagePost: true, video: true, coverImage: true, tags: true, categories: false, scheduledPublish: false, draft: false, markdown: false, richText: false, maxTitleLength: 1000, maxImageCount: 18, maxTagCount: 10, maxVideoSize: 1024 * 1024 * 1024, supportsVideoCover: true, supportsVideoTags: true, videoPublishAsync: false },
  manualInstructions: "需要先完成小红书小程序/开发者审核，并由用户在小红书客户端或官方组件内确认笔记发布；本 Adapter 不代替用户点击。"
};

export function mapXiaohongshuError(message: string, httpStatus?: number): ErrorCode { return mapManualError(message, httpStatus); }
export class XiaohongshuAdapter extends ManualOnlyAdapter { constructor() { super(definition); } }
export const XiaohongshuOfficialAdapter = XiaohongshuAdapter;
export default XiaohongshuAdapter;
