# Geo Media Publisher 项目状态

最后更新时间：2026-08-20 13:55（Asia/Shanghai）

## 当前版本

- 产品版本：Geo Media Publisher V0.4.0。
- 开发基线：V0.4 Resume 原位续建；没有重新初始化或创建新 starter。
- 仓库状态：当前目录没有 `.git` 元数据；本轮未执行 `git init`，也没有覆盖或清理现有项目。
- 安装包：`release/Geo Media Publisher Setup 0.4.0.exe`，ProductVersion/FileVersion 均为 `0.4.0`。

## 已完成

- Electron + React + TypeScript strict、SQLite、migration、AI Provider/DeepSeek、AI Batch、平台 Variant、图片 Provider/模板封面、持久化 Job Queue、Scheduler、PublishRecord、Reconciliation、safeStorage 凭据和 Windows NSIS 安装器保持可用。
- 平台生命周期补齐 `NotImplemented`，39 个平台在 `PLATFORMS.csv` 中各有唯一真实状态、实现方式、官方入口、阻塞原因和核验日期。
- 生产启动会同步 39 个外部平台目录；TestPlatform 只在开发环境注册，不进入生产目录。
- 统一 manifest 驱动凭据 UI/IPC、配置/过期状态、OAuth 开始/回调完成/登录检查链路；Renderer 不读取 Secret，OAuth 在官方 HTTPS 页面完成。
- safeStorage 可用性检查会真实解密；日志增加 Token/Cookie/Authorization 脱敏；Publisher 平台调用与自动回查有超时和截止期限，超时不无限重试。
- 数据库 migration 共 6 个：`0000_initial.sql` 至 `0005_v04_status_truth.sql`。
- 外部 Adapter 共 8 个：微信公众号、抖音、快手、哔哩哔哩、YouTube、TikTok、今日头条、Facebook Pages；另有 1 个仅用于本地验收的 TestPlatform。
- 本轮新增今日头条官方短视频 Adapter 与 Facebook Pages 官方文本/链接 Feed Adapter，均有独立 manifest/capability/validation/error/mock HTTP 测试。
- 25 个没有公开写入能力或官方自动化许可的平台明确为 `ManualOnly`；没有建立猜测 selector 或私有接口。

## 进行中

- 快手、哔哩哔哩仍需复核当前官方 endpoint/scope 合同。
- YouTube Desktop OAuth 和 TikTok 本地媒体上传链路尚未闭环。
- Instagram Professional 需要先扩展可审计的公网媒体资产模型；当前本地路径输入无法满足官方 Content Publishing 拉取要求，因此不创建伪 Adapter。
- 爱奇艺、微博虽已确认官方能力，但尚无独立 Adapter。

## 平台状态统计

统计范围为 `PLATFORMS.csv` 的 39 个外部平台，不含 TestPlatform。

| 状态 | 数量 | 平台 |
|---|---:|---|
| Stable | 0 | — |
| PublishPassed | 0 | — |
| DryRunPassed | 0 | — |
| CodeComplete | 1 | Facebook Pages |
| WaitingForUser | 3 | 微信公众号、抖音、今日头条 |
| Developing | 4 | 快手、哔哩哔哩、TikTok、YouTube |
| ManualOnly | 25 | 见 `docs/V0.4_PLATFORM_STATUS.md` |
| Blocked | 2 | 小红书、企鹅号 |
| NotImplemented | 4 | 新浪微博、爱奇艺、Instagram Professional、其他账号 |

说明：Facebook Pages 的 `CodeComplete` 仅指其限定范围内的 OAuth、文本/链接 Feed 发布、external ID 与回查代码和 mock 测试完成；真实 Dry Run、真实发布和 owner 验收均未执行。所有外部平台的 `DryRunPassed`、`PublishPassed`、`Stable` 均真实保持为 0。

## 阻塞

- 本轮没有用户提供的真实平台凭据、账号所有者授权、开发者审核或发布权限，因此不执行任何真实外部发布。
- Facebook Pages 需要 Meta App Review/Advanced Access、真实 OAuth 和可管理 Page；微信公众号、抖音、今日头条需要各自官方权限与凭据。
- 小红书新分享 SDK 接入暂停且无可靠发布结果回查；企鹅号新开发者及第三方服务资格申请暂停。
- 其余 ManualOnly 平台没有足以授权程序化发布的公开官方能力；后台存在不等于允许 Browser 自动化。
- 当前没有代码签名证书和定制应用图标；安装器使用 electron-builder 默认 Electron 图标，签名仅使用构建环境可用的工具链，不构成受信任发行证书。

## 测试与构建

- `pnpm lint`：PASS。
- `pnpm typecheck`：PASS。
- `pnpm test`：PASS，21 个测试文件 / 106 项测试。
- `pnpm test:stress`：PASS，10,000 篇文章、500 个账号、50,000 个 Job；查询 30ms，Scheduler 452ms，总计 1,872ms。
- `pnpm build`：PASS。
- `pnpm installer`：PASS。
- 安装包 SHA-256：`6FEA52A7919B479197CD3B452D05029EA906B3ECCB9CFFBF6A7E9F2B66FB6739`。
- 安装资源已核验：包含 `0000`–`0005` 全部 migration；打包 CSV 与源码 SHA-256 相同，11 列、39 行、0 个畸形行；主进程 bundle 含今日头条和 Facebook Pages Adapter。

## 下一步

1. 按 `MANUAL_ACTIONS.md` 由账号所有者完成微信公众号、抖音、今日头条和 Facebook Pages 的官方授权与低量 Dry Run。
2. 取得脱敏证据后再做人工确认发布，并保存 external ID、URL、PublishRecord 和最终回查状态。
3. 优先闭环快手/B 站合同、YouTube OAuth、TikTok 本地媒体上传；随后为爱奇艺、微博、Instagram 分别建立独立输入合同和 Adapter。
4. 为正式发行补充受信任 Windows 代码签名证书和品牌图标，再重建安装包。

