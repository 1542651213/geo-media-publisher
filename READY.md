# Geo Media Publisher 当前状态与恢复入口

本文件是 `GEO_PUBLISHER_GITHUB_RELEASE_AND_READY_20260920` 冻结任务的唯一优先状态入口。新会话、新电脑或新的维护人员应先阅读本文件，再检查 Git 和正式安装；不要从旧的 R67/R69、Task10S 或聊天记录重新推导当前状态。

## 1. 项目概览

Geo Media Publisher（矩阵发布工作台）是一个 Windows Electron 应用，用于多公司、多账号、多平台的内容准备、审核、发布和状态收口。技术栈是 Electron、TypeScript、Playwright、SQLite/better-sqlite3。

当前重点包括：

- 普通小红书文章发布主线；
- 康一、汇泉、树派等官网 Publishing API 的后续对接方向；
- 已有的其他平台 Adapter。其他平台没有因为本次 XHS 验证而获得生产稳定性结论。

平台发布仍须通过 Adapter、持久化 Job Queue、内容快照和 PublishRecord。验证码、短信和平台风控必须由 Owner 在官方页面完成。

## 2. 本次正式冻结版本

| 字段 | 值 |
| --- | --- |
| Repository | `1542651213/geo-media-publisher` |
| Branch | `codex/xhs-limited-production-ready-20260920` |
| Source commit | `4ddc58e16e19f8e5617c3ec583ade497323532e1` |
| Tag | `xhs-limited-production-ready-20260920` |
| Package version | `1.1.9` |
| Electron | `37.10.3` |
| Electron ABI | `138` |
| Migration count | `29` |
| Highest migration | `0028_production_pilot_slots.sql` |

Windows Release 资产：

- 文件：`geo-media-publisher-1.1.9-xhs-limited-production-ready-20260920-win-x64.zip`
- ZIP SHA256：`71D1698B16EB4C243BD054F6333D73B5B8E1BC2B5FB5AB5A3DFE65DB5DACC633`
- `Geo Media Publisher.exe` SHA256：`8FC59F68799A0D658A0CC3D61704C644E661CA08DCA871EF52BF01A4842E5EDC`
- `resources/app.asar` SHA256：`DC09F0DECAE34A2B760A4443846D71C85BFFB16C321C22820C5169179AE644E6`
- `better_sqlite3.node` SHA256：`AFA1DCAEDFC94D399413F18662D5FDA9C7025A23BC8CEF064D2986A0CEF2F60E`

正式安装目录 `C:\GMP116ZhihuL5\Geo Media Publisher` 只是本机历史运行环境示例，不能作为其他机器的固定路径。当前运行进程的可执行文件路径和上述正式目录一致；正式 pilot 配置也绑定了相同 EXE 和 `app.asar` 哈希。

## 3. 当前能力状态总表

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| XHS ordinary prepare | READY | 普通文章库、账号身份、单图、内容回读和 guard 已验证 |
| XHS single-image upload | VERIFIED_ONCE | 一次真实普通文章链路验证过 |
| XHS editor fill | VERIFIED_ONCE | 标题、正文和图片已填入官方编辑器 |
| XHS raw/canonical readback | READY | raw 保留，`xhs-editor-canonical-v1` 仅处理已知格式差异 |
| Immutable content snapshot | READY | snapshot 记录 raw title/body、hash 和图片事实 |
| Content binding | READY | Article、account/Creator、image、Job、snapshot 绑定 |
| Final submit guard | READY | F01 barrier、intent、dispatch claim、slot、final submit cap |
| Unknown duplicate prevention | READY | Unknown 禁止补发、换 Job、复制 Article 或清 slot |
| Real XHS submission | VERIFIED_ONCE | 只证明一次普通 UI 真实发布 |
| OwnerVerified reconciliation | READY | 同一 Unknown intent 的受控人工收口 |
| Automatic manager-list delta | NOT_VERIFIED | 真实 DOM 稳定身份证据不足，不能自动宣布 Published |
| Multi-image | NOT_VERIFIED | 本次 pilot 只验证单图 |
| Video | NOT_VERIFIED | 未验收 |
| Background/headless | NOT_VERIFIED | 未验收 |
| Sustained multi-account production | NOT_VERIFIED | 未验收 |
| Website Publishing API | NOT_IMPLEMENTED | 作为下一主线 |

## 4. 小红书真实验收历史

2026-09-20 的唯一真实样本来自普通文章库，链路为：

`文章库 → 账号核验 → 单图 → prepare → immutable snapshot → AwaitingConfirmation → Owner确认 → 一次 final submit → CLICK_DISPATCHED → UNKNOWN_SCHEMA → Creator Manager “已发布”列表确认 → OWNER_MANAGER_LIST 收口`。

脱敏审计 ID：

- Job：`a0527e53-fb5e-480c-affb-5cb38ad8560d`
- intent：`9940f151-f643-47b8-9867-c6f880b20066`
- content snapshot/binding：`fd56b1e7-3b6f-4161-969b-075257bcecc4`
- PublishRecord：`743b8634-e1b9-481a-a3f9-6cc0843ae94b`
- Creator：`960803317`

平台只读确认：

- 标题：`江苏病媒防制服务，沟通前确认五项`
- Creator Manager 显示时间：`2026-09-20 11:02`
- 平台列表：已发布

这是测试账号和测试内容的验收事实，不表示品牌策略、所有账号或所有内容都已验证。Cookie、profile、storage state 和原始请求/响应不进入仓库。

## 5. 为什么真实发布后曾显示 Unknown

本次 receipt 观察到多个 `t2.xiaohongshu.com` 请求，响应是 HTTP 200 和：

```json
{"code":0,"success":true}
```

响应没有 `noteId`、`externalId` 或 canonical URL，多个请求也无法唯一归属创建动作。因此 generic success 不能自动等于 Published，系统保持 `UNKNOWN_SCHEMA` 并冻结重复发送。这是 fail-closed 的安全结果，不是“可以再发一次”的信号。

## 6. OwnerVerified reconciliation

OwnerVerified 是受控的人工外部确认入口，不是 retry，也不是普通 Renderer 布尔开关。收口必须同时满足：

1. intent 当前为 Unknown，且 `final_submit_count=1`；
2. dispatch 已 Claim；
3. IPC Job ID、intent.jobId、pilot slot.jobId、PublishRecord.jobId 一致；
4. account、Creator、Article 和不可变 snapshot 一致；
5. Owner 在同一 Creator 的 Manager “已发布”列表中确认唯一标题记录；
6. 没有冲突候选。

历史事实使用 `snapshot.rawTitle`，不依赖后来可变的 `Article.title`。`externalId` 和 URL 可以为 `null`，但必须记录 `verificationSource=OWNER_MANAGER_LIST`、观察时间和页面来源。重复 Owner 确认必须幂等；错误 Job、intent、account、snapshot 或标题必须拒绝。pilot 过期只阻止新的 final submit，不阻止已发送 Unknown 的只读收口。

当前这笔记录的最终状态为：Job `Success`，intent `Submitted`，PublishRecord `Published/OwnerVerified`，pilot slot `1/1`。本次任务没有创建新的发送资格。

## 7. Manager List Delta

Manager List Delta 已有保守实现，但自动能力保持 `NOT_VERIFIED`。真实生产 DOM 尚未证明稳定的 noteId、canonical href 或稳定 item identity 合同。

未来自动判定必须：

- 以 `noteId → canonical href → 经验证稳定的 item/data id → row identity` 为身份优先级；
- 对 baseline/current 做 canonical identity 比较；
- 使用页面 `displayedTime` 并验证提交时间窗口，不能用 `observedAt` 冒充平台发布时间；
- Creator 必须来自同一已验证 BrowserSession 或明确页面级证明；
- expected thumbnail 存在时，actual 缺失或不一致必须保持 Unknown；
- 只有唯一新条目、标题/snapshot、Creator、时间和缩略图证据都一致才可确认。

同标题历史帖、变化的 `data-row-key`、generic `code=0`、HTTP 200 和 `observedAt` 单独都不能确认为 Published。没有经验证 selector 合同时，自动能力继续是 `NOT_VERIFIED`，OwnerVerified 是合法 fallback。

## 8. 防重复发布设计

F01 submission barrier 贯穿普通发布：

`scope → Job → content binding → submission intent → dispatch claim → final_submit_count → slot → receipt/reconciliation`。

必须区分：claim 发生、send 函数调用、平台接受、平台 Published。Unknown 和 `NeedsReconciliation` 都是安全状态：同一个 Unknown 不能 retry，不能换 Job，不能复制 Article，不能换账号，不能清 slot，不能删除 intent，也不能新建 pilot 恢复额度。任何不确定的网络响应都不能返还名额。

## 9. 不可变内容授权

`ConfirmedContentSnapshot` 保存 raw title/body、canonical title/body、hash、图片 bytes/hash、account/Creator 和 Article 事实。`contentBindingId` 把 Job、PublishRecord、intent 和 snapshot 绑定起来。

确认后修改正文、换图、跨进程换包或改变账号都会使旧确认失效，必须通过正常业务流程重新准备。不能覆盖历史 snapshot，也不能手改数据库把新内容伪装成旧确认。

## 10. XHS editor canonicalization

当前版本为 `xhs-editor-canonical-v1`。真实页面曾出现 expected body length `146`、actual length `152`；可见文字相同，仅因富文本编辑器产生多余空段换行。系统继续保存 raw expected/raw actual，只在明确的 CRLF/LF、paragraph/div/br 等已定义等价差异下比较 canonical 值。

它不是“忽略所有换行”：增删或替换任何可见汉字、词语、正文段落仍必须失败。

## 11. 当前平台内容限制

当前普通 XHS pilot 的保守本地规则是：

- 标题不超过 20 个 UTF-16 单位；
- 正文不超过 1000 个 UTF-16 单位；
- exactly 1 image；
- 不设置独立封面；
- `tags=[]`。

这些是本项目当前 pilot 规则，不是已经核实的小红书官方最新限制。平台规则变化时必须重新核对并更新实现与文档。

## 12. Formal pilot / 授权

当前 pilot：`GEO_XHS_PRODUCTION_PILOT_SINGLE_UNTIL_REVOKED_20260919`。

- 授权模式：`UNTIL_REVOKED`；
- `maxFinalSubmissions=1`；
- 当前 slot：`1/1`，已被真实样本占用；
- 包身份由 EXE/app.asar 路径和 SHA256 绑定；
- pilot 是受控试运营/验收机制，不是产品最终权限体系。

历史配置文件名可能仍带 `MAX3_20260918`，不能据此推断当前授权；必须读取其 JSON 并核对实际包哈希和 `UNTIL_REVOKED`。

## 13. 历史 Unknown

历史 Unknown 必须保留，不能删除、清空或用缺日志证明“没有发送”。不能复制 Article 换 ID、换账号或换 Job 绕过原操作。只能对原 intent 做只读检查或受控 OwnerVerified 收口。原始 receipt、Cookie 和 profile 不复制到 READY.md 或 GitHub。

## 14. 正式安装/数据库安全

生产 DB、WAL/SHM、production userData、browser profile、Cookie、credentials 和 raw receipt 永远不进入 GitHub。升级顺序：

1. 正常退出 GEO；
2. 创建 SQLite 一致性备份并运行 integrity check；
3. 保留完整旧安装；
4. 完整包切换，不只替换 `app.asar`；
5. 检查 migration parity；
6. 启动并核对实际进程路径、formal guard 和账号身份。

数据库必须通过正常 Repository/migration 逻辑使用，不能 SQL DELETE 或直接修改状态回收名额。旧程序是否兼容已应用的新 migration，回滚前必须单独验证。

## 15. Build / Test

本冻结版本的相关源码在构建快照与冻结 commit 间已核对无差异。实际执行记录：

- XHS manager-list focused tests：8 passed；
- production-pilot repository focused tests：11 passed；
- receipt observer focused tests：9 passed；
- ordinary XHS Electron integration：32 passed；
- TypeScript typecheck：passed；
- ESLint/lint：passed；
- `pnpm package:dir`：passed；
- packaged migration parity：`PASS`，source 29 / package 29。

本任务只做冻结、文档、manifest 和 Release 复核，没有重新执行新的真实发布，也没有把历史全量审计结果冒充本轮测试。与官网、Task10S 或其他平台无关的全量测试：`NOT_RUN`。

## 16. 已知限制

- automatic XHS manager delta：`NOT_VERIFIED`；
- generic receipt 无法自动确认 Published；
- 多图、视频未验收；
- headless/background 未验收；
- 长期多账号稳定性未验收；
- Computer Use 是 Codex 环境能力，不是产品功能保证；
- 历史 Task10S 诊断不属于普通文章库产品入口；
- 一次 Published 验证不等于所有平台或所有账号生产稳定。

## 17. 试运营 SOP

普通 XHS 操作按以下顺序：

`文章库 → 选择文章 → 选择已登录账号 → 选择单图 → 发布前确认 → Prepare → 核对账号/Creator、标题、正文、图片 hash、snapshot、Job 和 guard → Confirm → 只点击一次 → 等待结果`。

若结果明确 Published，结束本篇。若是 Accepted/Pending，记录状态，不把它写成 Published。若是 Unknown，绝不重发；只读打开同一 Creator 的 Manager 列表，随后使用 OwnerVerified reconciliation 收口。验证码、短信或二维码必须在官方窗口正常完成。不要使用 Task10S 代替普通文章库入口。

## 18. 回滚 SOP

回滚前先备份数据库并记录当前 migration。保留旧完整安装和当前正式安装，使用完整包回滚；不能只覆盖单个 `app.asar`。数据库如果已经应用新 migration，必须先验证旧程序兼容性，不得看到旧目录就直接启动。

## 19. GitHub / Release 恢复方法

```powershell
git clone https://github.com/1542651213/geo-media-publisher.git
cd geo-media-publisher
git checkout xhs-limited-production-ready-20260920
corepack enable
pnpm install --frozen-lockfile
pnpm rebuild:native
pnpm typecheck
pnpm lint
pnpm verify:packaged-migrations
```

随后从同名 GitHub Release 下载 Windows ZIP，解压为完整目录，核对 ZIP、EXE、`app.asar` 和 native SHA256，再按第 14 节流程部署。命令不包含本机秘密，也不携带生产 DB/profile。

## 20. 官网 Publishing API 下一阶段

官网是下一主线：

`GEO Media Publisher → 康一/汇泉/树派官网 Publishing API → 行业科普/现场案例 → API 返回 contentId/taskId/URL/status → GEO Repository 收口`。

官网不依赖 XHS Cookie、Creator、DOM 或 native picker。它应复用 F01 防重复、F02 内容快照/绑定和可信状态合同。

建议接口至少支持：

- `POST article`；
- `POST media` 或媒体引用；
- `Idempotency-Key`；
- `contentHash`；
- company/site identity；
- `GET status`；
- `contentId`、`publishedUrl`。

同一幂等键和同一 hash 必须返回同一资源；同一幂等键和不同 hash 必须拒绝。官网开发不属于本次冻结任务。

## 21. NEXT CHAT / CODEX START HERE

1. 先读 `READY.md`、`release/RELEASE_MANIFEST.json` 和本次 Release 说明；
2. 运行 `git status`，核对 HEAD/tag 和远端分支；
3. 从同名 Release 下载 ZIP，复核远端资产 SHA256；
4. 不再从 R67/R69 历史报告重新推导当前状态；
5. 不再重新证明 XHS 是否能发布；
6. 官网 Publishing API 成为下一主线；
7. XHS 仅按现场具体 bug 定点维护，不扩大为新发布批次；
8. 任何新真实提交必须获得新的明确授权，并重新核对 slot、intent 和包身份。

## 22. 禁止错误结论

- Task10S 成功 ≠ 普通文章库成功；
- prepare 成功 ≠ 已提交；
- click dispatched ≠ 平台已接受；
- `code=0` ≠ Published；
- HTTP 200 ≠ Published；
- OwnerVerified ≠ 自动 receipt classifier；
- Published once ≠ 多账号稳定；
- 当前 pilot limits ≠ 官方 XHS limits；
- GitHub source exists ≠ installed package is same build。

## 安全扫描记录

冻结任务扫描了 Git tracked 文件、工作区待提交文件、`release/RELEASE_MANIFEST.json`、`READY.md` 及 Release 资产清单，排查 `token`、`cookie`、`authorization`、`bearer`、`apiKey`、`api_key`、`secret`、`password`、`storageState`、`credentials`、`publisher.db`、`browser-profiles`、`production-data` 和敏感文件名。代码中出现的脱敏字段名、正向/反向测试字符串和路径校验规则不包含真实凭据；未发现生产数据库、Cookie/profile、credentials、raw receipt、`.env` 密钥、回滚目录或 workspace `node_modules` 被提交或上传。

扫描结论：`PASS`。
