# 康一 OfficialAPI V2：正式契约与已验收实现边界

R1.15-C_KANGYI_OFFICIAL_API 的产品实现、双环境 live acceptance、最终部门 NSIS 和安装版重启验收已完成。Website 普通发布 **ON**、批量 **OFF**；Douyin 普通 **ON**、批量 **OFF**。包身份和交付状态见 [Release handoff](../releases/R1.15-C-READY.md)，脱敏证据见 [acceptance summary](../evidence/r115-c/acceptance-summary.json)。仅私有 GitHub 推送因 Owner 尚未配置目标而未完成，当前 public origin 未推送。

## 已核实来源

- GEO 从 `d2aa3c3f2c173c186c567421bbc4657ae32eec45` 的 main 基线开始；历史 Website tag `archive-website-adapters-20260928` 只提供 CMS V2 signing/client/contracts 的可核对来源，没有覆盖 Publisher、Main、迁移或其它平台 Adapter。
- Kangyi 两环境当前运行包 SHA256 为 `fcc39c01d38211ecde42c95665b1272f8773ab1efa3e7328988fe737cb208406`，runtimeSourceCommit / packageSourceCommit 均为 `8ac541c5518e44e3b1f23c0b9d9169ba0d0460fd`。
- 本任务没有修改 Kangyi CMS schema、API、HMAC、idempotency、Nginx 或站点源码。两环境的 CMS / Site units、health、capabilities 和 OpenAPI V2 均已核实。
- 两环境真实凭据只经 Main 原生文件入口进入 SafeStorage；secret 和凭据文件路径不进入 Renderer、日志、文档或验收产物。

## 固定 scope 与 HMAC

固定 `siteId=kangyi`。staging origin=`https://staging.kangyihb.com`；production origin=`https://xn--4gq502b.com`。只调用 `/_publish-api/v2`，不使用 Admin transport、Browser publish 或失败后的替代通道。

Canonical HMAC 输入严格为 8 行：

1. 大写 METHOD
2. 精确 pathname + query
3. siteId
4. environment
5. 秒级 timestamp
6. nonce
7. Idempotency-Key；GET 为空串
8. 实际请求字节 SHA256

八行只以 LF 连接，末尾没有额外 LF。secret 是原始 UTF-8 字节，不 trim、不 Base64 decode。签名格式为 `sha256=<lowercase hex>`。nonce 为 32–64 个小写十六进制字符；每次请求使用新 nonce。POST/PUT 的 operation key 为 8–128 字符，exact JSON bytes 持久化后不得重排。

客户端写请求只发送一次；`maxRetries` 只影响 GET。response loss、timeout 或 5xx 后保留原 operation key、exact bytes 和 durable identity，进入只读恢复，不创建替代内容、版本、媒体或 publish Job。

## API 与限制

Capabilities 返回 siteId、environment、protocolVersion、contentKinds、limits、writesEnabled。`writesEnabled=true` 不代表拥有 purge 权限；部署合同没有 per-action permission 或 supportedActions 字段。

- JSON 最大 1 MiB。
- raw media 最大 8 MiB。
- 图片单边最大 10,000 px，总像素最大 40,000,000。
- 媒体只接受 PNG、JPEG、WebP；Main 从实际字节计算 MIME、尺寸和 SHA256，私有 GET 再核对响应 metadata、实际 byte count 与实际 SHA256。
- blocks 最大 100；禁止任意 HTML。paragraph/quote、heading、list、image 均按 CMS V2 字段上限验证。

| API | 必须保存或验证的绑定 |
| --- | --- |
| GET `/health`、`/capabilities` | protocolVersion、site、environment、content kind、limits、writesEnabled |
| POST `/media`；GET `/media/:id` | 原 operation key、mediaId、SHA256、MIME、bytes、width、height |
| POST `/contents` | externalId、exact draft；contentId、revisionId、contentHash、rowVersion |
| PUT `/contents/:id/draft` | rowVersion、exact draft；新 revision/hash/version |
| POST `/contents/:id/validate` | exact revisionId；valid 与 fieldErrors |
| POST `/contents/:id/publish` | revisionId、contentHash、rowVersion；HTTP 202 只表示 queued |
| GET `/jobs/:id` | site/env/content/revision/hash、状态、可信 publicUrl |
| unpublish / delete / restore / rollback | 当前 rowVersion、published revision fence、独立 operation identity |
| purge | 当前 rowVersion、Main 绑定的 acceptanceRunId、deleted 与 task-owned 资格 |

维护 Job 的 `revisionId` / `contentHash` 在当前合同中应为精确 `null`；runtime 将这组 nullable binding 持久化并核对。仍处于非终态的旧 journal 没有该 binding 时 fail closed，不能据 remote Job ID 猜测归属。已经以 local `SUCCEEDED`、remote `succeeded` 和既有读回证据完成的历史维护保持终态，runtime 不重新轮询或降级它。

## ARTICLE 与 CASE 映射

共同字段为 kind、受控 ASCII slug、title、summary、category、seoTitle、seoDescription 和 controlled blocks。ARTICLE 使用 keywords、takeaways、showOnHomepage；CASE 使用 location、listSummary、detailIntro、serviceFocus 等实际 schema 字段。简单 Excel 来源缺少 summary/category/keywords 时，普通 Website 表单要求操作者明确填写；系统不生成公司事实或改写正文。

图片只允许当前文章同品牌素材，或明确 `universal=true` 的已启用素材。Main 在冻结时重新读取文件并校验实际格式、尺寸、大小和 SHA256；冻结 source、scope、settings、图片身份和 contentBindingId 在清理前不可变。Renderer 只取得安全图片选项，不取得 Website journal 的文件路径或 exact JSON。

## 已实现的产品边界

- 通用 OfficialApiAdapter、Kangyi SiteConfig、signed CMS V2 client 和私有媒体 GET 校验。
- Main SafeStorage 凭据导入、双环境账号隔离、每次操作前的 live capability verification。
- ARTICLE / CASE 映射、图片上传、草稿、验证、一次 confirmed final submit、Job 轮询与 public fidelity。
- SQLite durable operation journal；崩溃后只恢复原 operation，不生成替代 identity。
- SubmissionIntent 的最终边界仍是唯一权威：只有 `finalSubmitCount=0`、没有 boundary、没有 publish step 的原 PREPARED preflight 才可恢复为同一 Prepared intent；最终边界进入后永不重试。
- 维护仅接受本地已有 Website jobId，并从 journal 派生 content/revision/rowVersion。调用者不能传 remote ID 或自行声明 purge 权限。
- 维护状态以最后一个 maintenance step 为准：最后一步 `FAILED` 显示其终态错误，不回退到原 publish Job 推断成功；remote `needs_attention` 保持 `NEEDS_RECONCILIATION`。
- package-owned 临时候选必须精确匹配 account/article/site/environment/key/kind/contentBindingId 且未过期。普通 Website 已开启后仍要求已验证可写账号和人工 final confirmation；batch 保持关闭。

## Live acceptance 结论

- staging ARTICLE 和 CASE 各创建一个受控对象，各只有一个逻辑 publish；真实 reply-loss、原操作恢复、raw SSR、私有/公开图片校验及 purge cleanup 均 PASS，替代内容为 0。
- staging 原配置字节与 owner 已恢复，新建 grant keys 已移除。原有 Basic Auth 保留，因此匿名 public fidelity 得到 401 并记录 `PUBLIC_PAGE_UNAVAILABLE` warning；使用既有认证读取时 raw SSR 与图片 HTTP 200 均 PASS。该 warning 不授权重发。
- production 通过普通安装版 UI 创建唯一对象 `6a81e7ff-d239-47b2-99b5-aa09e28337df`，publish Job `efd97474-7572-4606-b046-2d03200cc848`；逻辑 publish=1、媒体=3，restart、raw SSR、browser、private media 与 public fidelity 均 PASS。
- production 按 unpublish → delete → restore → delete 完成安全维护，最终公开页 404；业务 active/published 基线仍为 84。当前正式 API 对 `is_test=0` 对象没有 purge 权限，因此没有伪造 purge。三张合成媒体按既有保留策略 RETAINED。
- 本地既有 64 张表及业务行均保留。为恢复验收前状态，仅通过 Main 既有 `accounts:update` 恢复一次 Douyin enabled 开关；因此两条审计时间戳如实变化，但没有登录或发布。既有加密 credential entries 全部未改变。

## 仍需长期保留的 fail-closed 边界

- idempotency cache 有效期为 48 小时。只有 GET 已证明当前 rowVersion 严格大于原 publish body 版本、原 exact request 不可能再次入队时，才可用原 key + 原 bytes 读取缓存；缓存过期后按版本门禁失败，不能改 key 重发。
- 首次 media POST 响应完全丢失且没有 mediaId 时，公开 API 无 operation-by-key 查询。这是明确的 `ARCHITECTURE_GAP`：保持 NeedsReconciliation，不重新上传，也不猜 mediaId。
- HTTP 202、内容 published pointer 或 SSR 200 均不能单独证明 Published。原 exact publish Job=`succeeded` 且返回可信同 scope `publicUrl` 时，写入 Publish Success；raw SSR、media 与 public 页面读回另记 `PublicContentVerified=PASS/FAIL/LIMITED`。fidelity warning 不撤销已证实的 Publish Success，也不授权重发。
- production 合成媒体的保留是既有服务策略，不属于未完成 cleanup，也不能以内容已删除为理由绕过媒体保留规则。
