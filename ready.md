# Geo Media Publisher

Geo Media Publisher 是 Windows 上的多平台内容运营工作台，用于管理文章、图片素材、平台账号、发布任务和发布后的作品回查，并为网站 Publishing API 与未来 AI 内容生成提供统一入口。当前应用版本是 1.1.9；当前部门交付版本为 R1.15 Douyin Release，R1.14 FINAL 保留为历史归档。它是持续开发中的产品，不应把单次平台验收解释为所有普通运营入口已可批量生产。

本仓库的长期正式分支是 main。R1.14 的公开纯源码快照为 85707e7bec68c01f3959d8447e61ab0b359b133f；本文件随 main promotion commit 加入，因此当前 main HEAD 请运行 git rev-parse HEAD 查询，不在此写入自引用 SHA。原始经过真实验收的运行时代码提交为 31a7495bcb24ee5a85e992d3f8f0a1d28c4d7575。公开历史经过净化，移除了历史生成二进制和私有加密凭据备份；本地原始 all-refs Git Bundle 仅供受控灾难恢复，绝不可上传。

## 先读：能力与开关

- Douyin 图文：普通 UI B01 已完成一次真实发布（Remote Work ID `7691247987888016655`），可信 ID 与唯一管理页 Published 确认后为 PUBLISHED_CONFIRMED；公开内容一致性独立为 FAIL（旧正文换行显示成字面 `*`）。Release 已改为逐段输入并保留严格正文回读，离线隔离编辑器测试通过；禁止为验证修复再发第二条。普通图文发布 ON，批量 OFF；支持每 Job 一个明确选择的账号、一张图片、标题最多 20 个 UTF-16 计数单位、公开、立即、无音乐。Smart Music deferred。
- Toutiao 图文：一个限定范围的 BrowserNative 候选达到 PUBLISHED_CONFIRMED；普通发布入口仍 OFF。
- Weibo：已有真实发布 PASS 的历史证据；普通 UI 需要产品级复验。
- Sohu：历史单次发布经更正后的只读回查为 Published / Verified；普通 UI 仍需复验。
- Website：Publishing API 与 Adapter 工作保存在归档 Tag；staging 验收不等于生产站点已切换。
- 其它平台按下表逐项开放。任何真实发布都需要精确账号、内容和一次提交范围的 Owner 授权。

## 技术栈与目录

- Electron 37 桌面应用，Main 管理敏感状态、持久化 Job、IPC、BrowserSession 和发布边界；Renderer（React）提供运营界面，不得直接读取数据库或完整 secret。
- TypeScript 严格模式；pnpm 工作区及锁文件；electron-vite 构建；ESLint、Vitest；Playwright Core 驱动应用自有浏览器；SQLite / better-sqlite3 与迁移；SafeStorage 保存敏感凭据。
- apps/desktop/src/main、renderer、preload：桌面主进程、界面和受控桥接。
- packages/domain：Article、Job 和发布领域模型；packages/db：Repository 和 migrations；packages/publisher：队列、准备、一次性提交及回查。
- packages/adapters：各平台 PlatformAdapter；packages/security：敏感信息与边界；packages/ai、image、logger：配套能力。
- tests/ 与各模块独立测试记录核心不变量。package.json 定义准确的脚本和打包资源。

better-sqlite3 是原生模块：普通 host Node 与 Electron 的 ABI 可能不同。生产 Repository 写入及验收任务应由项目认可的 Electron 兼容运行时执行，不要让临时 host Node 脚本直接写 production publisher.db。schema 改动必须以 migration 完成。

## 普通运营平台定位

CURRENT PRODUCT UI STATE（R1.15 Douyin Release）：首页、账号中心、发布抽屉、发布中心和统计统一使用十平台策略，顺序为抖音、小红书、官网、今日头条、搜狐号、网易号、百家号、微博、列举网、博客园。只有 Douyin ordinaryPublishEnabled=true；Douyin batchPublishEnabled=false，其它九个平台 ordinary/batch 全为 false。显示不等于可发布。Release 隐藏 B01 验收创建/批准入口，员工不需要 B01 marker 或授权流程，使用普通内容库、手动选择单图与账号、明确公开可见、准备后确认一次提交。Main 独立校验 Adapter capability、当前 app-owned canonical Page/Context、Creator identity 与 AUTHENTICATED；DB logged_in 不能代替验证。历史 B01 任务仍执行原一次性授权门禁，不能借 ordinary ON 绕过。

最新 durable milestone：已将 Douyin Publish Success 与 Public Content Fidelity 分离。发布成功必须有持久 final_submit_count=1、可信 Remote Work ID、唯一且同一目标的 Published 管理证据；公开内容另记 PASS / FAIL / LIMITED。公开内容失败只告警，不触发 retry、第二次点击、替代 Job、Node/API replay 或 transport fallback。正文输入不再 bulk fill 多行，而通过编辑器 Enter 创建段落、逐段插入，再严格回读完整正文；不会把 `*` 忽略或归一化为换行。三段隔离 Slate 事件/DOM fixture 通过；本轮没有第二次真实发布，因此修复后的公开平台序列化未另行实发复验。

当前 B01：PUBLISH_RESULT=PUBLISHED_CONFIRMED，MANAGEMENT_PAGE_VERIFIED=PASS，PUBLIC_CONTENT_VERIFIED=FAIL，质量告警 BODY_LINEBREAK_RENDERED_AS_LITERAL_ASTERISK。Article `11c657d8-157a-47f9-97ae-071391c30ba7`，短 marker `B01-E30344`；Image `19e321db-6fb0-4f8b-ba40-255e19cc4d6c`，Main 实读 SHA256 `9427f88b5c190102dfcc1a03a9dc9031540dbdb3a0c26bda22ceaaadbf9a66aa`。授权 `74c08921-5278-475a-aab3-d840687d60bb` Consumed；Job `ee500df1-8dd7-4cae-b047-dece77884874` Success；Intent `5f2f0c33-0f8b-4c2b-b068-78eaa88cbbcc`；Record `f79087cb-b574-4c46-b22e-f6311106f54d` Published。Remote Work ID `7691247987888016655`，实际观察的公开 URL https://www.douyin.com/note/7691247987888016655 。一次 final claim、一次 BrowserNative final action、一次真实发布，Node replay=0，重启持久化正常。

迁移 `0029_douyin_publish_content_outcome.sql` 仅新增独立结果/质量表，为这个精确已发布作品追加解释；原 Job / SubmissionIntent / PublishRecord、Remote Work ID、冻结内容和 final_submit_count 不变。原 Intent.remote_status=PUBLISHED_MANAGEMENT、Record.verification_status=WaitingUser、原公开证据仍原样保留，不篡改成正文保真 PASS。Repository/UI 读取独立结果层显示“已发布 / 公开内容不一致”，禁止重发。迁移在受保护生产副本上首次应用及重启通过，原既有业务表逐表内容未变；生产快照只留本机，不上传。

Release identity / validation：`Geo Media Publisher Setup 1.1.9 - R1.15 DOUYIN RELEASE.exe`，SHA256 `CCD6BBFC1C0129B6F7B46997F906197868881FC3A93BD47B45723E7AB964C021`；`app.asar` SHA256 `BF66B578639E5AF6C8376838E1C381F6F85E797A41D51C00160FDBD5F3D4D2A1`。typecheck / lint / build 全部 PASS；full suite 170 files / 1165 tests PASS，无 skip。NSIS 安装和 Main/Renderer 包内字节一致性通过；显式隔离 userData 与正常 production userData 的首页、文章、图片、账号、发布详情、统计及重启 smoke 通过，B01 入口隐藏，未验证账号仍禁用。实际生产迁移后逐表对照保护快照，原 62 个业务表完全未变；当前及历史 unresolved Job/Intent/Record 未变、提交总计数不变，integrity / foreign_key check PASS，独立 outcome 表一行。本轮 REAL_PUBLISH=0、FINAL_CLAIM=0，不访问真实 Douyin。历史 R1.14 FINAL、Candidate R2/R3/R4 和 HOTFIX 不覆盖、不删除。B01 Product E2E 的发布成功已由 Owner 按两层契约接受；旧作品公开内容 FAIL 将永久保留。NEXT_TASK=R1.15-B02_WEIBO_NORMAL_UI_PRODUCT_E2E。

旧未提交 Job `76748f23-d2d5-4a18-baf8-4770e1b39118` 已经普通 UI/Main 永久取消，旧授权 `R1.15-B01` 为 Revoked；旧冻结内容/绑定保留且未改变。历史 unresolved Job `fc78bf51-812a-490e-91eb-a9320793adc2` 与其 Intent/Record 再次逐行对照受控快照确认完全未变；生产 integrity_check / foreign_key_check 通过。所有凭据、browser-profiles、受控快照、Git Bundle 和历史安装包继续保护。

暂时隐藏：视频号、公众号、腾讯新闻、闲鱼、58 同城、地方新媒体、权威媒体及其它当前没有业务需求的平台。隐藏是产品展示决定，不删除历史数据、账号、Job 或 Adapter；有新业务需求时重新评估能力与验收。

| 平台 | 截至 R1.14 的证据状态 | 下一门禁 |
| --- | --- | --- |
| Douyin image/text | PUBLISHED_CONFIRMED；一个账号、一图、普通标题/正文、公开、立即、无音乐 | 普通 UI 发布成功已接受；普通图文 ON、批量 OFF；Smart Music deferred |
| Toutiao article | 限定 BrowserNative 路线 PUBLISHED_CONFIRMED | 普通 UI Product E2E；普通提交仍 OFF |
| Weibo | 历史真实 PublishPassed=PASS | 普通 UI 产品复验 |
| Sohu | 历史 Published / Verified | 普通 UI 产品复验 |
| Website | Publishing API / Adapter 工作已归档 | 正式生产站点契约及 Product E2E |
| Xiaohongshu | 部分实现和测试；普通生产全链路验收未完成 | 保持门禁 |
| Baijiahao | CONTENT_EDITOR_NOT_VERIFIED | 编辑器与完整发布验收 |
| Zhihu | 历史 NeedsReconciliation | 旧未知 Job 只读回查，禁止重试 |
| Lieju | 风控/验证阶段，非最终 product-ready | Owner 验证与独立能力门禁 |
| CNBlogs | 现有 API 基础 | 普通产品 E2E |
| NetEase | 下一新增平台的计划 | 独立 Adapter 和独立测试 |

这些是截至归档时的状态，不是当前登录态。平台是否已登录必须重新由应用自有会话验证。

## 永久发布安全规则

全局正式发布并发为 1。每一次正式发布必须有持久化 Article/Job、SubmissionIntent 和 PublishRecord，且 Job Queue 可审计、可在崩溃或重启后安全恢复。平台专用 selector、登录判断、编辑器填写、设置、最终动作和回查必须封装在该平台的 PlatformAdapter；不要让某平台修复污染共享 Publisher 或其它 Adapter。

最终不可逆浏览器动作之前，Main 必须原子地把 final_submit_count 从 0 claim 到 1，并记录 submission attempt。claim 失败时不点击。claim 成功后，只允许该任务的一次最终动作；禁止再次点击、Node replay、API fallback、换 transport 或创建替代 Job 再投一次。超时、响应丢失、页面关闭和未知结果都进入 NeedsReconciliation，之后仅做只读管理页/公开页回查。HTTP 200、success toast 或页面跳转本身都不等于 Published。Douyin 必须有可信作品 ID 与唯一 Published 管理页确认才能 PUBLISHED_CONFIRMED；公开内容一致性为独立 PASS / FAIL / LIMITED 质量状态，不能触发重试。其它平台按其独立已验收契约执行。

准备阶段的内容与设置要严格回读，并与冻结的 account、Article、Job、标题、正文、图片、可见性、时机和已启用的附加功能绑定。失败在 final claim 之前应停在安全的 pre-boundary 状态；不要把未提交误记成 NeedsReconciliation，也不要为了赶进度跳过门禁。

## 浏览器、账号与安全验证

BrowserSession、BrowserContext、canonical app-owned Playwright Page 和稳定远端账号身份必须相互对应。DB 中的 logged_in 只是本地记录，不是当前平台身份或会话有效的证明。以应用自有 Page 的真实 URL、DOM、作品管理页和公开页作为平台事实来源；桌面窗口标题、无关浏览器标签、猜测的 public URL 和截图推断不能单独作为正式证据。

二维码、短信、CAPTCHA、滑块、设备确认、实名和风控挑战由 Owner 在平台正常流程中完成。自动化不得绕过、识别代填、伪造或破解。登录失效时暂停相应账号，不得无限重试。

禁止输出或保存明文 Cookie、Token、签名、StorageState、credentials 或 API Key；日志只保留有界脱敏摘要。未来 AI Provider Key 由 Main + SafeStorage 管理；Renderer 只取得 configured / not configured、遮罩显示与受控连接测试结果，绝不读取完整 secret。

## 一次正式发布的生命周期

1. 从内容库读取批准 Article，明确账号、平台、内容与素材；创建持久 Job，并做能力/授权/preflight。
2. 激活该账号的 BrowserSession，验证 Context 与 canonical Page 归属、平台 host、远端账号身份和登录代数。
3. 进入空白编辑器；在当前 Job 的唯一操作额度内上传素材、填写标题/正文/设置。对图片数量与加载、标题、语义正文、可见性和时机做严格 readback。
4. 只有被本任务明确启用的附加功能才进入其独立准备与回读；未启用音乐的 Core NO-MUSIC 路径不运行音乐 DOM 自动化。
5. Douyin B01 准备门禁通过后先持久化 Prepared PublishRecord，授权保持 Prepared（等待 Owner 最终批准）；此时尚无 SubmissionIntent。Main 在另一次 Owner 批准请求中重核冻结绑定、应用自有远端身份及编辑器严格回读，然后才可进入 FinalApproved。
6. 正式执行阶段才创建现有 SubmissionIntent；Main 在不可逆动作前原子 claim final_submit_count 0→1，同时消费 B01 授权。只在成功后执行一次 BrowserNative 最终动作。被动观察真实 Browser 响应，不重放请求。
7. 最终动作后只读 reconcile：Douyin 可信 Remote ID 与唯一管理页 Published 匹配后为 PUBLISHED_CONFIRMED；公开页完整标题/正文/图片回读单独记录 Public Content Fidelity。审核中、未通过、结果未知不得提前记成功。
8. 无论结果如何，保留 Job/Intent/Record、操作次数和证据。NeedsUserAction、NeedsReconciliation、Failed、Published/Verified 的区别不能用乐观猜测抹平。

## 本地开发与验证

Repository: https://github.com/1542651213/geo-media-publisher
Canonical branch: main
推荐 Windows 本地工作区：D:\GEO_MEDIA_PUBLISHER_FINAL\source\geo-media-publisher。不同环境可在其它位置重新 clone；不要把用户名路径写入业务代码。

准备 Node.js 与项目锁定的 pnpm 11.19.0（可用 Corepack），再按仓库 package.json / pnpm-lock.yaml 安装。Windows 打包使用 Electron 对应的 better-sqlite3 native rebuild；不要把 host Node 的 native 产物覆盖正在运行的 Electron 安装版。

    pnpm install --frozen-lockfile
    pnpm typecheck
    pnpm lint
    pnpm build
    pnpm exec vitest run --maxWorkers=2

纯源码仓库可能不跟踪 output/。若测试依赖这个目录，先在仓库根目录创建空 output/，再运行完整测试；不得删测试、skip 或降低断言。R1.14 纯源码基线在受限并发下通过 158 个测试文件、1110 项测试，typecheck、lint、build 均通过。修改平台 Adapter 后运行其独立测试及完整回归。真实平台验收与离线测试是两种证据，不能互相冒充。

生产数据位于 %APPDATA%\codex-media-publisher，可能包含 publisher.db、credentials.enc、browser-profiles、media 和 Session 状态。DO NOT DELETE；DO NOT COMMIT；DO NOT UPLOAD。开发测试使用隔离数据，不把 production-data 带入源码或公开 Release。

## 正式 Release 与历史恢复

历史安装包（继续保护）：Geo Media Publisher Setup 1.1.9 - R1.14 FINAL.exe。SHA-256：417D94CD4CD47569C40E5F0B55339A2069F3DA1618785AAD6A048A5D4BBE6214。GitHub Release Tag：geo-media-publisher-r1.14-20260928。安装包是 Release Asset，不加入 Git 源码历史；R1.15 使用独立新安装包，不覆盖这个历史文件。

| 保留 Tag | 指向的提交 | 原分支/用途 |
| --- | --- | --- |
| geo-media-publisher-r1.14-20260928 | 85707e7bec68c01f3959d8447e61ab0b359b133f | R1.14 纯源码 Release |
| archive-website-adapters-20260928 | 901e2ea7f97c451aa1efc5fdd7bbe53ec8f71aca | Website Adapter |
| archive-toutiao-r1-20260928 | eb73b62e76ab2486fadbd09a074bbe22ed12d630 | Toutiao BrowserNative R1 |
| archive-xhs-task10w-20260928 | 8782e6cc4f70067ebb00746d21aaa7cd1c2fc261 | Xiaohongshu Task10W |
| archive-r67-docs-20260928 | 29efcb6da7881232fe97d22447410c9cb1e789c0 | R67 文档 |
| archive-sohu-k2-residual-20260928 | 1ac96b5bade1dd2116c0d9d5587d26360438e1e2 | Sohu/K2 残余源码 |

已有的 XHS 历史 Release/Pilot Tags 同样保留。Tag 让已退休分支的确切公开提交可恢复。完整原始 all-refs Git Bundle 只保存在受控的本地私有归档，可能含历史 private material；不要上传 GitHub、附件或工单。详细历史见 Git history、Tags、PROJECT_STATE.md 和平台 runbook；不要把 ready.md 改成流水账。

## 下一阶段路线

- Phase A：R1.15-A01 已完成普通运营平台白名单和 UI 收口；隐藏不再需要的平台入口，同时保留历史数据。
- Phase B：正式安装版普通用户路径 Product E2E，优先 Douyin、Weibo、Toutiao、Sohu、Website。测试真实 UI/IPC/账户选择/Job/回查，不以独立 runner 成功代替产品验收。
- Phase C：分别完成 Xiaohongshu、Baijiahao、Lieju、CNBlogs 的身份、编辑器、内容、唯一 final submit、回查及普通 UI E2E。
- Phase D：新增 NetEase 独立 Adapter 和独立测试，复用既有 Job、Intent、Record、BrowserSession 与一次性边界；不另造发布框架。
- Phase E：AI Provider Center，优先 Xiaomi MiMo。提供 Provider/Model 下拉、Default Model、API Key 的 Main/SafeStorage 管理和 Test Connection，再支持 OpenAI、DeepSeek、Ollama、Custom OpenAI-Compatible。数据库仅持久化 provider、model、baseUrl、configured 等非秘密元数据，不存明文 Key。

路线图是计划，不是当前能力声明。

## DO NOT

- DO NOT second-submit 结果未知或已 claim 的作品；不以替代 Job 重发。
- DO NOT 绕过 CAPTCHA、短信、扫码或实名验证。
- DO NOT 记录或上传 raw Cookie、Token、签名、StorageState、凭据、API Key。
- DO NOT 用 DB logged_in 代替当前远端账号身份。
- DO NOT 拼猜公开 URL 或只凭 toast / HTTP 200 写 Published。
- DO NOT 在普通 UI Product E2E 前打开批量或普通正式提交开关。
- DO NOT 因 Adapter 单测通过就宣称平台生产可用。
- DO NOT 删除或上传 %APPDATA%\codex-media-publisher。
- DO NOT 上传本地原始 Git Bundle 或历史私有备份。
- DO NOT 无产品需求地恢复隐藏平台入口。

## 接手 Checklist

1. 先读本 ready.md、AGENTS.md、当前平台 runbook 与目标模块源码。
2. 运行 git status 和 git rev-parse HEAD；核对当前 main、工作区是否干净及是否有用户未提交改动。
3. 查目标平台最新的持久状态、能力边界与账号授权；旧日志不能代表当前登录态。
4. 设计任何真实发布前先明确唯一 Article/Job、素材、内容、账号和提交额度；保护 final_submit_count 一次性边界。
5. 改动只在相应 PlatformAdapter 与必要公共模块中进行；用独立测试、typecheck、lint、完整测试和 build 验证。
6. 将新里程碑的 CURRENT STATE、长期架构规则、最新已验证平台状态与 NEXT ACTION 更新到 ready.md；详细过程放入 Git 提交、Tag、证据和平台 runbook，不堆积流水账。
