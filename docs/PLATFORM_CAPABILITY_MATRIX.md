# 平台能力矩阵（V0.4）

研究日期：2026-08-20；小红书 gate-only 工程状态补充于 2026-08-27。范围为 `PLATFORMS.csv` 的 39 个外部平台；本地 TestPlatform 不计入。

逐平台运行状态、认证、内容类型、Dry Run、Publish、阻塞与下一步以 [V0.4 平台状态](V0.4_PLATFORM_STATUS.md) 为准。CSV 同时保存每个平台唯一生命周期、传输方式、官方入口、阻塞原因和最后核验日期，应用启动时会同步该目录。

## 研究结论

| 能力类别 | 平台 | 当前工程结论 |
|---|---|---|
| 已有官方 API Adapter | 微信公众号、抖音、快手、哔哩哔哩、TikTok、YouTube、今日头条、Facebook Pages | 代码和 mock 测试不能升级真实状态；Facebook Pages 限定文本/链接且为 `CodeComplete`，没有真实 Dry Run |
| 官方 API/SDK 已确认但未实现 | 新浪微博、爱奇艺、Instagram Professional | 只能标记 `NotImplemented`；必须按平台建立独立 Adapter、鉴权、测试和回查 |
| 小红书 BrowserAutomation gate-only | 小红书 | 现有账号可通过应用自有 Session 做身份、图文编辑器、图片/标题/正文和最终控件 discovery；本轮不点击最终发布、不创建 Job/Intent/PublishRecord，也不声明 `PublishPassed` |
| 官方能力当前阻塞 | 企鹅号 | 企鹅号新开发者及第三方服务申请暂停 |
| 仅人工操作 | 其余 25 个平台 | 未确认公开内容写入 API 或官方允许的 Browser 自动化，保持 `ManualOnly` |
| 扩展占位 | 其他账号 | 不建立“万能 Adapter”；确定具体平台后新增唯一 key 和独立包 |

## 生命周期定义

- `Stable`：重复真实发布、回查、错误恢复和 owner 验收均有证据。
- `PublishPassed`：至少一次授权账号低量真实发布成功，保存 external ID、URL 和最终状态。
- `DryRunPassed`：在真实平台账号完成不触发最终公开发布的安全验证并保存脱敏证据。
- `CodeComplete`：代码、类型、lint、独立测试和错误处理均完成，但尚无 owner 凭据门槛。
- `Developing`：实现仍缺合同、媒体链路、OAuth 或其他工程闭环。
- `WaitingForUser`：可继续前必须由账号所有者提供凭据、官方权限或正常授权。
- `ManualOnly`：当前只允许用户在官方页面/App 中人工操作。
- `Blocked`：官方接入、资格或能力明确阻断当前方案。
- `NotImplemented`：候选能力已研究或平台尚未定义，但当前没有可运行 Adapter。

## 官方能力边界

- 发布优先级固定为官方 API → 官方 SDK → 官方明确允许的 Browser 自动化 → ManualOnly。
- 小红书本轮只实现账号所有者主动触发的 BrowserAutomation gate-only 路径；这不是官方 API/SDK 授权，也不等于平台允许后台自动化。
- BrowserAutomation 只使用账号隔离的 `session:{platformKey}:{accountId}`，遇到登录、安全验证或页面证据不足立即暂停。
- 验证码、安全验证、人机验证、账号注册和 OAuth 不得绕过；遇到时暂停对应账号。
- Facebook 仅覆盖 Pages，不包含个人主页。Instagram 仅覆盖 Business/Creator 专业账号，且必须是独立 Adapter。
- 爱奇艺号 API 已确认支持 Token 鉴权、视频上传/发布、`qipuId` 和状态查询，但当前 endpoint 合同仍需真实控制台确认。
- 无法可靠回查最终状态的平台即使提交成功，也只能进入 `NeedsReconciliation`。

## 关键官方来源

- [微信公众号官方文档](https://developers.weixin.qq.com/doc/offiaccount/)
- [抖音开放平台](https://open.douyin.com/)、[快手开放平台](https://open.kuaishou.com/)、[哔哩哔哩开放平台](https://openhome.bilibili.com/)
- [TikTok Content Posting API](https://developers.tiktok.com/products/content-posting-api/)与[YouTube Data API](https://developers.google.com/youtube/v3)
- [微博 CLI](https://open.weibo.com/cli)与[爱奇艺号 API](https://creator-open.iqiyi.com/api-reference)
- [Facebook Page Feed API](https://developers.facebook.com/docs/graph-api/reference/page/feed/)与[Instagram Content Publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing/)
- [视频号助手](https://channels.weixin.qq.com/)、[腾讯微视产品页](https://www.tencent.com/products/weishi/)、[搜狐视频创作中心](https://tv.sohu.com/s/center/index.html)
- [多多视频创作者后台](https://live.yangkeduo.com/creator)、[快传号](https://kuaichuan.360kuai.com/)、[风行号创作者手册](https://o.fun.tv/pgc/handbook)
