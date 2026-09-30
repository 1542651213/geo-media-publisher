# R1.15-C Kangyi OfficialAPI：执行计划与完成台账

Authority：Owner attachment `GEO_R1_15_C_KANGYI_OFFICIAL_API_ONE_SHOT_CODEX_TASK.md` 与连续执行授权。canonical checkout 为 `D:\GEO_MEDIA_PUBLISHER_FINAL\source\geo-media-publisher`；branch 为 `release/2026-09-30-r1.15-c-kangyi-officialapi`。

本文件保留最初计划，并以最终事实标注完成状态。实际 START_HEAD 是 `30acabdd6ca13e371145dd55153698608c41bfff`，已经包含 fresh `origin/main=d2aa3c3f2c173c186c567421bbc4657ae32eec45`；执行中没有 reset 或回退 main。包内运行时代码 source commit 为 `86727b9250135282ab2fa247fe1a5dc3f5f791b5`；最终文档交付 HEAD 由 local release tag 解析，避免自引用 SHA。最终安装与打包门禁已通过。

## 初始历史状态

任务早期从只读合同和 connection Candidate 开始。旧 HMAC 在当前用户上下文无法解密时，系统保持零远端写并记录 credential stop。这个 `CREDENTIALS_REQUIRED_NOT_READY` 是当时正确的停止条件，现在只作为历史 provenance：Owner 后续在本机提供真实 credential，普通账号中心通过 Main 原生文件选择器导入 SafeStorage，真实 staging-editor 与 production-admin health/capabilities 均验证通过。临时受限文件已删除，secret 从未输出或写入仓库。

Private Git 也曾并仍然缺少 Owner 配置的私有目标。现有 origin 是 public，因此没有 push 或更改 visibility。这个阻塞只影响最终 Git 交付，不是产品实现、live acceptance 或 package 技术失败。

## Task 1：合同、签名与安全连接 — COMPLETE

- 核对 deployed health、capabilities、OpenAPI V2、Kangyi handoff/source 和历史 Website tag。
- 复用经过核对的 CMS V2 signing/client/contracts；固定精确 8 行 LF HMAC、原始 UTF-8 secret、exact body bytes，并禁止自动写重试。
- Main-only credential-file import 写入 SafeStorage；staging/production 账号、principal、site/environment/protocol scope 独立。
- Renderer 只收到 metadata，不收到 secret、凭据路径、exact JSON 或 journal 内部内容。
- 每次 prepare/final/maintenance 前重新验证 connection、writes、kind、grant expiry；await 返回后再核对授权。
- 实际账号：staging `6894966b-7e69-4740-834f-ca8842fe9466` / `staging-editor`；production `54fde62d-68e0-4aa3-91a9-8afb8217c70d` / `production-admin`。这里只记录真实 label/principal，不记录 secret。

## Task 2：mapping 与 durable publishing — COMPLETE

- ARTICLE/CASE 使用实际 schema，简单 Excel 缺少 summary/category/keywords 时由普通 Website UI 明确输入；系统不生成公司事实。
- 图片只允许已启用的同品牌 asset 或明确 universal asset。Main 重新读取并校验真实 MIME、尺寸、byte count、SHA256；CMS private GET 再验证 metadata 与实际 bytes SHA。
- journal 持久化 immutable source/scope/settings/images/content binding、operation key、exact JSON/raw hash 与远端 identity。
- prepare 完成 media/content/draft/validate；final 必须由人工 confirmed 后进入现有 Scheduled、SubmissionIntent final boundary 和 PublishRecord。
- 所有写操作在不确定后只恢复原 identity；不创建替代 content/revision/media/publish Job。
- 48 小时 idempotency cache 只在 original-version fence 已证明原请求不能再次 enqueue 时，才允许原 key + 原 bytes 读取缓存响应；缓存过期继续 fail closed。
- media POST 首次 response 完全丢失且无 mediaId 时，公开合同没有 lookup，保持 `ARCHITECTURE_GAP/NeedsReconciliation`。

## Task 3：普通 UI、恢复与维护 — COMPLETE

- 普通账号中心、ARTICLE/CASE 设置、安全图片候选、prepare/confirm/result、connection metadata 和 maintenance UI 已接入。
- Website ordinary **ON**、batch **OFF**；Douyin ordinary **ON**、batch **OFF**；其它平台门禁未改变。
- Website 不接受 dry-run 代替 final confirmation，通用 Retry 不能直接 dispatch Website。
- final preflight 失败时，只有原 PREPARED operation 且不存在 publish step、boundary、remote request/response/external ID、`finalSubmitCount=0`，才原子恢复同一 SubmissionIntent；attempt history 不变。
- maintenance 只接受本地 existing Website job；remote IDs、revision/hash/version 和 purge authority 都从 Main journal 派生。
- nullable maintenance binding 必须精确匹配。非终态旧 journal 缺 binding 时 fail closed；已有 local `SUCCEEDED`、remote `succeeded` 和读回证据的历史维护保持终态。
- local/remote 双重 succeeded 才是成功终态；最新 step=`FAILED` 显示自身错误，remote `needs_attention` 保持 `NEEDS_RECONCILIATION`。
- Publish Success 由原 exact Job=`succeeded` 与可信同 scope `publicUrl` 确立；`PublicContentVerified=PASS/FAIL/LIMITED` 独立记录，fidelity warning 不授权重发。

## Task 4：安装版 live acceptance — COMPLETE

### Staging

- 普通安装版 UI 完成 ARTICLE 与 CASE 各一个对象、各一次 logical publish。
- ARTICLE：local `e978a8c5-46b5-4f81-b7f9-46f16e800ab0`；content `de42cf4d-9c2d-4d14-9fe5-455096c9ef8b`；publish Job `e9a08e47-09c2-4106-843a-f2ce14ca4f3e`。
- CASE：local `77e10f29-264f-4741-9168-830168f31762`；content `e8d20256-3587-4e44-ab11-f51d49b70c1e`；publish Job `885bb17a-2b8d-4b8d-9bba-a47a76f3dac0`。
- ARTICLE 真实 reply-loss 从原 operation 恢复，替代对象为 0，`duplicateContents=0`。
- 两对象均由各自 acceptance-run 既有服务端资格 purge；staging 原配置 bytes/owner 恢复，新 grant keys 移除。
- 既有 Basic Auth 保留；匿名 fidelity 401=`PUBLIC_PAGE_UNAVAILABLE` warning，authenticated raw SSR/images HTTP 200 PASS。发布成功没有因 fidelity warning 重发。

### Production

- normal installed UI Main Job `7c64dca3-c30f-4f35-b029-161c284a5f38`。
- 唯一 content `6a81e7ff-d239-47b2-99b5-aa09e28337df`；唯一 publish Job `efd97474-7572-4606-b046-2d03200cc848`。
- one logical publish、one media group、three media；restart、raw SSR、browser、private media、public fidelity 均 PASS，duplicate content=0。
- maintenance 完成 unpublish → delete → restore → delete；最终页面 404，业务 active/published 基线保持 84。
- normal `is_test=0` 对象没有 production purge permission；没有伪造 purge。三张 synthetic media 按既有 production policy `RETAINED`。

## Task 5：enable、review、regression、release 与 Git — SOURCE/LIVE COMPLETE；PACKAGE GATE IN PROGRESS

已完成：

- Website ordinary 已在 Task 4 PASS 后开启；batch 仍关闭。
- source implementation 独立审查的五项 Important 已全部修复：grant expiry/await recheck、同一 PREPARED intent 恢复、maintenance local+remote 双终态、nullable binding/legacy terminal 规则、FAILED/needs_attention 状态判定。
- typecheck、lint、build PASS。
- 前一 full baseline 为 1331 tests PASS。
- 本地原有 64 张表和业务 rows 保留；只通过 Main 既有 `accounts:update` 恢复一个 Douyin enabled 值，因此两条 audit timestamps 如实变化。没有 Douyin login/publish，所有既有 encrypted credential entries 未改变。
- Kangyi CMS schema/API/HMAC/idempotency/Nginx/site source 未变；Huiquan/Shupai 未配置或激活。

最终验证完成：full184files1332tests serial PASS、typecheck/lint/build PASS。两个并行 fixture 不稳定观测已在 Release 文档明确记录，没有 skip 或改动 Douyin。部门 installer/source identity固定，正常 production-data 两次安装版启动/双环境 live连接/原任务只读终态 PASS，新增远端写0。五项 Important 完成独立复核。最后服务器四unitactive、health200、业务基线和三对象唯一publish数保持。

本地 tag `r1.15-c-kangyi-officialapi-ready-20261001` 与 clean worktree 是本次最终交付；private push 仍为 BLOCKED_BY_OWNER_CONFIGURATION，当前 public origin 未推送。最终字段和实际 installer SHA/size 见 Release handoff。

## 运行与恢复 SOP

1. 从账号中心选择对应环境的 Kangyi OfficialAPI 账号；Main 从 SafeStorage 取 credential 并实时验证 scope/capabilities。
2. 选择 Website、ARTICLE/CASE、显式 metadata 和合法图片；Main 冻结实际 bytes 与 immutable binding。
3. prepare 后必须处于 AwaitingConfirmation；人工 confirmed final 后才能进入 Scheduled 和唯一 final submit。
4. Publish Success 与 public fidelity 分开显示。FAIL/LIMITED 只告警，不调用通用 Retry 或创建替代发布。
5. NeedsReconciliation 只执行 Website 原操作恢复。publish 已进入 final boundary 后永不重置 counter。
6. maintenance 只从原本地 Website job 发起。staging purge 必须拥有 Main package grant/acceptanceRunId/task-owned/deleted 资格；production normal object 永不伪造 purge。

## 数据与交付保护

- 既有 64 tables、业务 baseline 84、其它平台 rows 与 encrypted credentials 保留。
- 一次 Douyin enabled 恢复和两条相应 timestamp 是真实、允许且可解释的变更；不是登录或发布。
- staging/production acceptance 不需重跑；远端内容 cleanup 已完成到合同允许的边界。
- production 三张 retained media 是现行服务策略结果，不是遗漏 cleanup。
- packaging 不能读取 secret、不能再次 publish、不能为 smoke 创建 production 替代对象。
- Private Git 等待 Owner 配置私有目标；禁止向当前 public origin 推送或自行修改 visibility。

最终状态字段与 package identity 的权威表见 `docs/releases/R1.15-C-READY.md`。
