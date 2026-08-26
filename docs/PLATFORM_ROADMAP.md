# 平台接入路线图（V0.4）

最后核验：2026-08-20。路线图服从 [V0.4 平台状态](V0.4_PLATFORM_STATUS.md)；不以“有文件”或“有 Adapter”代替真实验收。

## 当前优先级

1. **Owner gate**：微信公众号、抖音、今日头条、Facebook Pages 取得账号所有者凭据和平台权限后，依次做真实 Dry Run、人工确认发布、external ID/URL 保存与状态回查。
2. **合同闭环**：快手、哔哩哔哩核对当前官方 endpoint 与 scope；YouTube 完成 Desktop OAuth；TikTok 补齐本地媒体到官方上传的链路。
3. **下一批独立 Adapter**：新浪微博、爱奇艺、Instagram Professional。每个平台独立包、独立 OAuth/Token、独立错误映射和测试。
4. **阻塞复核**：只在小红书恢复官方接入、企鹅号恢复资格申请或用户证明已有有效资格时重启开发。
5. **ManualOnly 维护**：其余 25 个平台只提供人工动作清单；没有官方许可时不建设 Browser selector。

## 固定阶段门

1. `Research gate`：记录官方来源、鉴权、权限、内容类型、审核、限流、响应 ID 和状态回查。
2. `Adapter gate`：平台代码只进入 `packages/adapters/<platform>`；业务层只通过 `PlatformAdapter` 和 Registry。
3. `Security gate`：所有 Secret 进入 Electron 主进程 safeStorage；Renderer 只看到配置/过期状态；日志不得包含 Token、Cookie 或 Authorization。
4. `Dry-run gate`：mock HTTP 只证明代码门禁；真实 `DryRunPassed` 必须来自授权平台账号且不触发最终公开发布。
5. `Owner approval gate`：真实发布必须经过持久化 Job Queue 和人工确认；账号 `allowAutoPublish` 默认关闭。
6. `Publish gate`：保存 external ID、URL、最终状态与 PublishRecord；不可回查时进入 `NeedsReconciliation`。
7. `Stable gate`：需要重复发布、故障恢复、登录失效暂停和 owner 验收证据。

## 批次验收

每个 Adapter 至少运行 manifest、capability、validation、error mapping 测试；官方 API 增加 mock HTTP 测试。每批依次运行 `pnpm lint`、`pnpm typecheck`、`pnpm test`。V0.4 交付再运行 `pnpm test:stress`、`pnpm build` 和 `pnpm installer`，并核验安装包内 migration、平台目录和生产无 TestPlatform。
