# 康一 OfficialAPI V2：当前契约与实现边界

Task: R1.15-C_KANGYI_OFFICIAL_API。当前交付状态是连接基础已实现、HMAC 凭据阻塞；不是官网发布 READY。

## 核对来源

GEO 起点 `d2aa3c3f2c173c186c567421bbc4657ae32eec45`，当时 main=origin/main、工作区 clean。历史 Website tag `archive-website-adapters-20260928` 指向 `901e2ea7f97c451aa1efc5fdd7bbe53ec8f71aca`，只恢复 CMS V2 signing/client/contracts，逐项对照当前 Kangyi 源码；未 cherry-pick 旧 Publisher、旧 Main、旧迁移或另建品牌 Adapter。

当前 Kangyi 正式交接源码位于 `D:\康一环保科技\康一K3-R2-authoring-r3-workspace`，HEAD `a23600ac6ef792e743e255fac8509f085f1b27a3`，只读、clean。读取了其 ready、`docs/cms-rollout/api/{GEO_INTEGRATION.md,DELETE_API_CONTRACT.md,openapi.json}`、`clients/cms-v2` 和 `gateway/src/cms/{http-v2,auth-v2,validation-v2,repository,publication}.ts`。交接声明部署源 `8ac541c5518e44e3b1f23c0b9d9169ba0d0460fd`、包 SHA256 `fcc39c01d38211ecde42c95665b1272f8773ab1efa3e7328988fe737cb208406`；这些是交接声明，尚未通过签名 live API 独立复验。

2026-09-30 只读 live health：staging / production 均 HTTP200、status=ok、protocolVersion=2。未签名 staging capabilities 为 HTTP401。没有可用 HMAC，不能把 health 通过写成 capabilities/permission/发布通过。

## Scope 与签名

固定 siteId=kangyi。staging origin=`https://staging.kangyihb.com`；production origin=`https://xn--4gq502b.com`。只调用 `/_publish-api/v2`，无 Admin transport、Browser publish 或 API fallback。

Canonical HMAC 输入依次为 METHOD 大写、精确 pathname+query、siteId、environment、秒级 timestamp、nonce、Idempotency-Key 或空串、实际请求字节 SHA256；8 行以 LF 连接，末尾不追加 LF。secret 使用原始 UTF-8，不 trim、不做 Base64 decode。签名为 `sha256=<lowercase hex>`。签名头只存在 Main 的 HTTP 请求内。

GET 无 body / Idempotency-Key；POST/PUT 必须保留 8–128 字符 operation key。每次请求使用新 nonce，原 exact JSON bytes 不重排。客户端默认不重试；即使显式设置 maxRetries，写请求也只发送一次，该设置只影响 GET。response loss/5xx 写结果为 outcomeUnknown，不能创建替代资源或再发布。

## 当前服务器形状

Capabilities: siteId、environment、protocolVersion、contentKinds(article/case)、limits、writesEnabled。没有 per-action permission / supportedActions 字段；不能以 writesEnabled 推导 purge 权限。limits：JSON 1MiB、raw media 8MiB、dimension 10000、40M pixels。媒体 PNG/JPEG/WebP。当前 Main 检查协议、站点、环境、types 和 limit 类型/范围。

| API | 请求 / 返回关键绑定 |
| --- | --- |
| GET /health、/capabilities | protocolVersion、当前 scope / capability |
| POST /media；GET /media/:id | raw image bytes；mediaId、sha256、mime、尺寸 |
| GET /contents | kind、externalId、status、page/pageSize；当前部署 status 只接受 active/deleted |
| POST /contents | externalId + draft；contentId、revisionId、contentHash、rowVersion |
| GET /contents/:id | exact scope、draft、revision 和 published pointer |
| PUT /contents/:id/draft | rowVersion + draft；新 revision/hash/version |
| POST /contents/:id/validate | revisionId；valid + fieldErrors |
| POST /contents/:id/publish | revisionId + contentHash + rowVersion；HTTP202 是 queued Job，不是 Published |
| GET /jobs/:id | queued/processing/verifying/succeeded/failed/needs_attention；可信 publicUrl |
| POST /contents/:id/unpublish | rowVersion + expectedPublishedRevisionId |
| POST /contents/:id/rollback | revisionId/hash/version + expectedPublishedRevisionId |
| POST /contents/:id/delete | rowVersion + expectedPublishedRevisionId + reason |
| POST /contents/:id/restore | rowVersion；仅恢复为 draft，不自动发布 |
| POST /contents/:id/purge | rowVersion + acceptanceRunId（权限要求时）；只允许 deleted 和 task-owned test objects |

继承的 OpenAPI list status enum 与部署 handler 不一致；客户端保留历史 published 字符串类型供兼容，但当前 live 调用不得发送 published filter。public DTO 不提供内部 isTest/testRunId，不得信任 Renderer 自报测试对象资格。

## ARTICLE / CASE 后续映射要求（尚未接入产品）

两类必须分开。共同 publish 字段：kind、ASCII 未保留 slug、title≤200、非空 controlled blocks、summary≤500、category、seoTitle、seoDescription≤300。ARTICLE 另需 keywords(≤20×100)、takeaways(≤20×300)、showOnHomepage boolean。CASE 另需 location/listSummary/detailIntro(≤3000)，可选 airQualityFocus/serviceFocus/referenceFor(≤20×500)。项目背景等展示字段按实际 CMS schema 配置，不虚构案例/资质/数据。

blocks≤100：paragraph/quote text≤5000；heading level2/3、text≤300；list≤30×500；image 为真实同 scope mediaId + alt≤300。coverMediaId、galleryMediaIds≤20、body image 共用媒体与版本引用。禁止任意 HTML。

## 已实现 / 未实现

已实现：通用 OfficialApiAdapter 连接层 + Kangyi SiteConfig；Main 本机文件导入到既有 SafeStorage；签名 health/capability 校验；普通账号中心显示双环境连接；Renderer metadata only；账号 scope 不可跨环境改绑；丢失凭据不会自动造替代账号。新 IPC 不提供 publish/purge/grant/status write。

尚未实现/验收：ARTICLE/CASE 表单与映射、durable operation journal、媒体/草稿 prepare、现有 final counter 接线、维护 UI、live unknown recovery、staging/prod 闭环。客户端低层 endpoint 方法存在不等于产品实现或验收。Website ordinary/batch 始终 OFF，Adapter direct publish fail closed。

恢复缺口：现有声明没有只读 operation/idempotency 查询接口。publish 响应全部丢失且未保存 remote Job ID 时，不能假设 GET/jobs identity 可得；media ID 丢失也不能默认重新上传。必须在有效凭据和实际合同下证明原操作可只读识别或明确未被接受，否则 NeedsReconciliation。见 recovery 文档。
