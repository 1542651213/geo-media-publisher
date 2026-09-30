# 康一 OfficialAPI：不可重复操作与恢复契约

本契约已由 durable runtime、SQLite journal、重启测试和双环境 live acceptance 验证。它是持续生效的产品边界，不是一次验收脚本的临时规则。

## 写前持久化与唯一最终边界

每个写步骤在发送前持久化 immutable account/site/environment/keyId、Article source、settings、图片 SHA/MIME/bytes/dimensions、contentBindingId、exact JSON 或 raw byte hash、operation key 和预期远端 identity。journal 不保存 secret。

POST/PUT 每个 logical operation 只发送一次。transport loss、timeout、5xx、响应 schema/binding 不匹配或进程崩溃后，不创建新 key、新 content、新 revision、新 media 或新 publish Job。状态进入 NeedsReconciliation，由原 job 的只读恢复处理。

正式 publish 继续使用 SubmissionIntent 和全局 formal-execution gate：

- `finalSubmitCount=0` 且没有 `submitBoundaryEnteredAt` 才可能进入最终边界。
- Adapter 只有在最终 preflight 全部通过、publish exact request 已持久化为 DISPATCHING 后，才调用 durable boundary claim。
- boundary 进入后 `finalSubmitCount=1`；任务永不 Retry，也不能恢复为 AwaitingConfirmation。
- 如果 final preflight 在任何 publish step 创建前失败，Publisher 可能已经创建并保留 submissionAttemptId。只在原 operation 仍为 PREPARED、没有 publish/remote Job、intent 为 Unknown、final count=0、没有 boundary、没有 remote request/response/external ID 时，Main 才在同一 SQLite transaction 将同一 intent 恢复为 Prepared。原 intent ID、attempt 和 submissionAttemptId 不变。

## 原操作恢复

有可信 remote Job ID 时，只读 `GET /jobs/:id`，核对 site、environment、operation、content、revision、hash 和保存的 maintenance nullable binding。queued/processing/verifying 只做有界轮询。原 exact publish Job=`succeeded` 且带可信同 scope `publicUrl` 时，发布结果为 Success；后续 content、raw SSR、media 与 public 页面读回形成独立 fidelity 结果。

首次 publish 响应丢失时，允许的 POST 仅是原缓存读取，且必须同时满足：

1. 使用原 principal、scope、method、target、operation key 和 exact bytes。
2. 先 GET 原 content，完整核对 externalId、contentId、revisionId、contentHash。
3. 当前 rowVersion 严格大于原 publish body 的 rowVersion，证明原 exact request 已经不可能再次通过 enqueuePublish 的旧版本门禁。
4. 仍在服务器 48 小时 idempotency cache 窗口内时，同 key/same bytes 可返回原 202 Job；changed bytes 必须冲突。

缓存过期时，版本门禁令原请求失败；这不授权换 key 重发。pending 且版本未改变、身份不一致或任何证据缺失时，不发送 POST。

HTTP 202、content published pointer 或 SSR 200 都不能单独证明 Published。原 exact Job=`succeeded` 且返回可信同 scope `publicUrl` 时，才能写 Publish Success。公开读回独立记录 `PublicContentVerified=PASS/FAIL/LIMITED`；FAIL/LIMITED 不撤销该 Publish Success，也不授权重新发送 publish。

## 媒体恢复

收到 mediaId 后，journal 立即保存返回 metadata，再用 signed private GET 核对 header 与实际 body byte count/SHA256；本地冻结的实际 MIME、尺寸与 SHA 仍是权威预期。

如果首次 media POST 响应完全丢失且没有 mediaId，当前公开 API 没有 operation-by-key 或 media-by-idempotency-key 查询。这一情形明确标记为 `ARCHITECTURE_GAP`：

- 不重新上传；
- 不创建替代 media identity；
- 不猜 mediaId；
- 保持 NeedsReconciliation，等待合同扩展或人工服务端证据。

## 维护恢复

unpublish、delete、restore、purge 各自拥有独立 maintenanceId、operation key、exact JSON 和 sourceRowVersion。调用者只能传本地 jobId 与动作名。

当前服务端维护 Job 的 `revisionId` 和 `contentHash` 应为 null。runtime 在 202 时保存 `{revisionId:null, contentHash:null}` 作为 exact jobBinding；非 null 返回进入 outcome unknown。仍处于非终态的旧 journal 若缺少 jobBinding，即使保存了 remote Job ID，也不轮询或宣告成功。已经以 local `SUCCEEDED`、remote `succeeded` 和既有读回证据完成的历史维护保持终态，runtime 直接返回该终态，不重新轮询。

维护本地状态只有在 step=`SUCCEEDED` 且 remote Job=`succeeded` 时才是终态。若读回成功发生在持久化本地 SUCCEEDED 之前，step 仍为 DISPATCHING/OUTCOME_UNKNOWN，UI 保持 `MAINTENANCE_*`，下次只恢复原维护操作。凭据轮换同样等待这一双重终态。

状态展示以最后一个 maintenance step 为准。最后一步=`FAILED` 时，显示该步骤的终态错误，不能在找不到当前维护成功证据时回退到原 publication Job。remote Job=`needs_attention` 仍为 `NEEDS_RECONCILIATION`，等待原操作的证据补全。

purge 还要求：原 publish 已 succeeded、当前内容 deleted、environment=staging、Main package grant 明确绑定 acceptanceRunId 和 permission。production 正常对象不能由 Renderer 或普通写账号自报为 test-only。

## Live 证据

- staging ARTICLE 与 CASE 各一次 logical publish；ARTICLE 包含真实 reply-loss，原 operation 成功恢复；替代内容为 0。两对象维护与 purge 均从各自原 journal 完成。
- production 普通安装版对象只有一个 content、一个 publish Job 和一次 logical publish；应用重启后从原 journal 恢复。随后 unpublish/delete/restore/delete 仍使用该对象的受控维护链，最终公开页 404。
- production 对象 `is_test=0` 且当前权限不允许 purge。系统保留 soft-deleted content 与三张合成媒体，没有伪造权限或篡改服务端数据。

fidelity FAIL/LIMITED、Basic Auth 导致的匿名 401、公开页面暂不可读等信号只产生告警。它们永远不能重置 final counter、触发替代 publish 或覆盖已有成功证据。
