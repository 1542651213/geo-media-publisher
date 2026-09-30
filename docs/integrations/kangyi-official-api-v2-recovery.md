# 康一 OfficialAPI：不可重复操作与恢复契约

此文是后续产品接线约束，尚未实现 operation journal/真实恢复验收。现阶段发布全面 fail closed。

## 已实现客户端防线

一次 POST/PUT 调用只发送一次；默认 maxRetries=0，显式 GET 重试预算不改变写请求。raw bytes / exactJson 原样签名并发送；transport loss/5xx 保留 operation key、outcomeUnknown=true，不自动重复请求。日志/错误消息不回显远端任意 message、签名或 secret。

## 必须沿用的产品边界

每次操作在发送前持久化 immutable scope/account/Article/media/hash、request body/key、remote content/revision/version/job identity；不得在 Job snapshot 持久化密钥。正式 publish 使用现有 SubmissionIntent + Main atomic final_submit_count 0→1/global concurrency1，不另造计数器。发送后未知状态=NeedsReconciliation；重启不恢复为可再次发布。fidelity FAIL/LIMITED 只告警，不能重发。

有可信 remote Job ID：只读 GET/jobs/:id，检查 site/env/content/revision/hash，pending 有界轮询；succeeded 且可信同 scope publicUrl 才认定 Published。可信 Content ID/externalId 可 GET 对照 draft/published pointer，但不能将“不在某一页列表”当成原请求未被接受。

无 remote Job ID 的完全响应丢失：当前 API 没有公开 operation-by-key/jobs-by-key 查询。不得猜 ID/publicUrl，不以第二 publish 来探测。媒体无 mediaId 也不得以重新上传当 recovery。继续验收必须从实际签名 API 合同获得可证明的原操作身份或明确未接受证据；否则保持只读待人工核对。

服务端 idempotency 48h 与永久 externalId reservation/tombstone 是防御层，不是 Main 自动 replay 授权。fixture 中显式同 key 重传测试只证明字节与 nonce 契约，不能授权生产重传。

## 安全维护

unpublish/delete/restore/purge 使用新的独立 operation identity；期待的 rowVersion/publishedRevision 不匹配即停止。只允许本次产品路径创建且服务器权限认可的对象。restore 只恢复 draft。purge 需额外人工确认、deleted 状态、task-owned测试资格与 acceptanceRunId/server permission；不以 writesEnabled 代替权限，不让 Renderer 自行指定任意内容为测试对象。

本轮 production publisher.db、credentials、BrowserSession、历史 unresolved Douyin Job 均未打开/改写；没有 migration。后续 schema 变更必须独立 additive migration，并在本地受控副本上检查 integrity/FK、重启和既有表语义。
