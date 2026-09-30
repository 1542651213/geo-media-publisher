# R1.15-C Kangyi OfficialAPI V2：live acceptance 最终 checkpoint

本文件是 R1.15-C_KANGYI_OFFICIAL_API 的 durable handoff，记录截至 2026-10-01（Asia/Shanghai）的最终 live 事实。功能实现、staging acceptance、production 普通安装版验收和受权 cleanup 均已完成。部门最终 NSIS、Release 文档和两次正常数据目录重启 smoke 也已 PASS；身份见 [Release handoff](../releases/R1.15-C-READY.md)，证据见 [acceptance summary](../evidence/r115-c/acceptance-summary.json)。本文件保留 live 事实，不能作为再次发布的授权。

## 来源与未改变范围

历史起点为 canonical checkout `D:\GEO_MEDIA_PUBLISHER_FINAL\source\geo-media-publisher`、branch `release/2026-09-30-r1.15-c-kangyi-officialapi`。原 main 基线为 `d2aa3c3f2c173c186c567421bbc4657ae32eec45`；历史 Website tag 只用于对照 CMS V2 client/signing/contracts。

两环境实际运行包保持：

| 项目 | staging | production |
| --- | --- | --- |
| origin | `https://staging.kangyihb.com` | `https://xn--4gq502b.com` |
| runtime package SHA256 | `fcc39c01d38211ecde42c95665b1272f8773ab1efa3e7328988fe737cb208406` | 同一包 |
| runtimeSourceCommit / packageSourceCommit | `8ac541c5518e44e3b1f23c0b9d9169ba0d0460fd` | 同一源 |
| protocol / kinds | V2 / article, case | V2 / article, case |
| 验收 Main accountId | `6894966b-7e69-4740-834f-ca8842fe9466` | `54fde62d-68e0-4aa3-91a9-8afb8217c70d` |
| principal | staging-editor（验收后恢复） | production-admin |

没有修改 Kangyi CMS schema、API、HMAC、idempotency、Nginx、站点源码或运行包。没有修改 Huiquan / Shupai。secret 没有读取到输出、文档、日志或仓库；两份 acceptance gate 均记录 `secretsPrinted=false`。

## 产品实现状态

普通安装版 Main 已包含 SafeStorage 导入、双环境账号、ARTICLE/CASE 设置、同品牌或 universal 图片选择、实际字节校验、durable operation journal、一次 confirmed final、原操作恢复、public fidelity 和受控维护。

五类 fresh-review 边界已合入：

1. package grant 到期后立即失效，UI availability、Main 请求授权和 runtime awaited-call guard 均重新检查。
2. prepared preflight 仅在没有 publish step、final count=0、没有 boundary/remote request/response/external ID 时恢复同一 SubmissionIntent；保留原 attempt ID，不创建新 final claim。
3. maintenance 只有 local step 与 remote Job 均 succeeded 才显示终态或允许凭据轮换；读回成功但本地仍 DISPATCHING 时保持 recoverable。
4. maintenance 202/GET 核对精确 nullable job binding；非终态旧 journal 缺失 binding、非 null revision/hash 或跨 operation identity 均 fail closed。已有 local `SUCCEEDED`、remote `succeeded` 和读回证据的历史维护保持终态，不重新轮询。
5. 最后一个 maintenance step=`FAILED` 时显示该终态错误，不回退到原 publication Job；remote `needs_attention` 保持 `NEEDS_RECONCILIATION`。

当前源码产品策略：Website ordinary **ON** / batch **OFF**；Douyin ordinary **ON** / batch **OFF**。其它平台策略没有因本任务改变。

发布状态与公开内容 fidelity 独立：原 exact publish Job=`succeeded` 且返回可信同 scope `publicUrl` 即记录 Publish Success；raw SSR、media 与 public 页面读回另记 `PublicContentVerified=PASS/FAIL/LIMITED`。fidelity warning 不撤销成功，也不授权重发。

## staging gate：PASS

证据摘要：`output/r115-c-execution-20260930/staging-acceptance-gate.json`。

| 内容 | 本地 Job | remote content | remote publish Job | 结果 |
| --- | --- | --- | --- | --- |
| ARTICLE | `e978a8c5-46b5-4f81-b7f9-46f16e800ab0` | `de42cf4d-9c2d-4d14-9fe5-455096c9ef8b` | `e9a08e47-09c2-4106-843a-f2ce14ca4f3e` | logical publish=1；raw SSR/media PASS；purge cleanup PASS |
| CASE | `77e10f29-264f-4741-9168-830168f31762` | `e8d20256-3587-4e44-ab11-f51d49b70c1e` | `885bb17a-2b8d-4b8d-9bba-a47a76f3dac0` | logical publish=1；raw SSR/media PASS；purge cleanup PASS |

验收通过普通安装版 UI 完成。ARTICLE 包含真实 reply loss；系统从原 operation 恢复，`originalOperationRecovered=true`，没有第二个 content，`duplicateContents=0`。两个对象均使用各自受控 run 的既有服务端资格清理，没有借普通 editor 权限伪造 purge。

验收后 staging 原配置字节及 owner 已恢复，新建 grant keys 已移除，Main account 恢复 staging-editor SafeStorage。站点原有 Basic Auth 保留：匿名 public fidelity 得到 401，因此本地记录 `PUBLIC_PAGE_UNAVAILABLE` warning；使用既有认证访问时 raw SSR 和图片 HTTP 200 均 PASS。这一匿名 warning 是访问条件差异，不是发布失败，也不授权重发。

## production gate：PASS

证据摘要：`output/r115-c-execution-20260930/production-acceptance-gate.json`。

- 正常安装版 UI：PASS。
- restart recovery：PASS。
- Main Job：`7c64dca3-c30f-4f35-b029-161c284a5f38`。
- 唯一 content：`6a81e7ff-d239-47b2-99b5-aa09e28337df`。
- 唯一 publish Job：`efd97474-7572-4606-b046-2d03200cc848`。
- logical publish count：1；duplicate contents：0。
- media group：1；media：3。
- raw SSR、browser、private media、public fidelity：PASS。

维护顺序为 unpublish → delete → restore → delete。最终公开页返回 404；验收前后 production 业务 active/published 基线均为 84，没有改写既有业务内容。

本地既有 64 张表及业务行均保留。验收收尾仅通过 Main 既有 `accounts:update` 恢复一次 Douyin enabled 开关，两条审计时间戳因此如实变化；没有登录或发布，既有加密 credential entries 均未改变。

该 production 对象是 normal `is_test=0` 内容，当前 API guard 不允许 purge。验收严格保留这一拒绝，没有创建 acceptanceRunId、没有改变对象资格、没有直接删库。三张合成媒体按现有 production 保留策略 RETAINED；public cache 仍可能返回 200。这是服务策略的已知结果，不是遗漏 cleanup。

## 恢复合同最终结论

服务器 idempotency cache 为 48 小时，并绑定 scope/principal/method/target/key/body。原 publish 响应丢失时，只有先 GET 证明当前 rowVersion 严格大于原 body version、从而证明原 exact request 无法再次入队，才可用原 key + 原 bytes 读取原缓存响应；缓存过期后按版本门禁 fail closed。不能换 key、重做 draft 或创建替代 publish。

如果 media POST 首次响应完全丢失且没有 mediaId，当前合同没有只读 lookup。这仍是 `ARCHITECTURE_GAP`：保持 NeedsReconciliation，不重复上传。此次 live gate 没有留下这种未知媒体。

维护 Job 的 revisionId/contentHash 为精确 null binding。runtime 保存并核对这组值；没有 exact binding 的非终态历史 journal 不自动轮询。已经以 local `SUCCEEDED`、remote `succeeded` 和既有读回证据完成的历史维护保持终态。

## 交付边界

远端 live 工作、部门安装包和 Release 验证均已结束，不需要再次发布、再次清理或再次读取 secret。最终交付采用本地 commit/tag 和 clean 核对；Private Git 交付受 Owner 仓库配置阻塞，不是实现或技术校验失败。禁止为包装验证重新创建 production 内容；禁止把三张 retained media 当成可绕过 API guard 的清理目标。
