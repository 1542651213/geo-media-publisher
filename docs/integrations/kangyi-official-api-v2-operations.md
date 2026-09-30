# 康一 OfficialAPI：安装版操作与交接

R1.15-C 的普通安装版 Website 路径已完成 staging / production live acceptance，最终部门 NSIS 及两次正常数据目录重启 smoke PASS。Website ordinary **ON**、batch **OFF**；Douyin ordinary **ON**、batch **OFF**。正式包身份见 [Release handoff](../releases/R1.15-C-READY.md)，证据见 [acceptance summary](../evidence/r115-c/acceptance-summary.json)。不得使用旧 Candidate 资源替代正式包。

## 已配置账号

| 环境 | Main accountId | principal | 当前用途 |
| --- | --- | --- | --- |
| staging | `6894966b-7e69-4740-834f-ca8842fe9466` | staging-editor | 已恢复到原 staging SafeStorage 配置；普通连接与后续正常发布 |
| production | `54fde62d-68e0-4aa3-91a9-8afb8217c70d` | production-admin | 已验收的 production 可写账号 |

secret 只保存在 Main SafeStorage。不要从数据库、日志、文档或验收输出提取 secret；不要求 Owner 再发送密码、PAT 或 HMAC 值。

## 安全导入与验证

需要重新导入时，只使用普通账号中心的 Main 原生文件选择器。文件字段严格为 origin、siteId、environment、keyId、secret；下面只有结构占位符，不是可用凭据：

```json
{
  "origin": "https://staging.kangyihb.com",
  "siteId": "kangyi",
  "environment": "staging",
  "keyId": "OWNER_LOCAL_KEY_ID",
  "secret": "OWNER_LOCAL_RAW_UTF8_SECRET"
}
```

production 使用 `https://xn--4gq502b.com` 和独立 production key。secret 是至少 32 UTF-8 字节的原始值，不 trim、不附加换行、不转码。导入文件不得放入 Git、源码、output、聊天附件或 Release。

Main 在写入 SafeStorage 前校验文件大小、字段、固定 origin/site/environment，并签名读取 health/capabilities。账号 scope 已绑定后不能跨环境改写；存在未清理的 durable operation 时不能轮换其凭据。Renderer 只收到连接 metadata，不接收 secret、凭据文件路径、exact JSON 或 journal 内部对象。

## 普通 Website 发布流程

1. 在账号中心检查 OfficialAPI 连接。Main 重新读取 SafeStorage 并验证当前协议、site、environment、content kind、limits 和 writesEnabled。
2. 在发布窗口选择 Website、已验证可写账号、ARTICLE 或 CASE，并明确填写所需 summary/category/keywords 等字段。
3. 只选择已启用的同品牌图片或明确的 universal 图片。Renderer 传 asset ID；Main 重新读取并冻结实际字节、MIME、尺寸、SHA256。
4. 「准备官网内容」依次完成媒体、内容、草稿和 validate，并持久化唯一 job、scope、source、settings、exact request bytes、operation keys 和远端 identity。
5. 准备完成后任务为 AwaitingConfirmation。Website 不接受 Dry Run；只有显式 confirmed final 才进入 Scheduled 和唯一 final submit。
6. HTTP 202 后保持 Publishing，直到原 exact remote Job=`succeeded`、scope/identity 一致且存在可信同 scope `publicUrl`，随后记录 Publish Success。raw SSR、media 与 public 页面读回独立记录 `PublicContentVerified=PASS/FAIL/LIMITED`；fidelity warning 只显示提醒，不撤销 Publish Success，也不创建第二次发布。

任务不得通过通用 Retry 重新执行 Website publish。NeedsReconciliation 使用「按原操作恢复」，只读取或恢复同一 journaled operation。final boundary 已进入、存在 publish step 或 outcome unknown 时，不能退回可确认状态。

## 维护操作

维护入口只接受本地既有 Website jobId。contentId、revisionId、contentHash、rowVersion、remote Job ID 和 operation key 全部由 Main journal 派生；Renderer 不能提供这些远端身份。

- unpublish、delete、restore 使用独立、持久化的维护 operation。
- restore 只恢复 draft，不自动重新发布。
- 当前 maintenance Job 的 revisionId/contentHash 是精确 null binding；返回非 null，或非终态旧 journal 缺少该 binding 时保持待恢复。已经以 local `SUCCEEDED`、remote `succeeded` 和既有读回证据完成的历史维护保持终态，不重新轮询。
- purge 只允许 staging、Main package grant 绑定的 acceptanceRunId、task-owned、deleted 对象。`writesEnabled=true` 不是 purge 授权。
- 只有本地 step=`SUCCEEDED` 且 remote Job=`succeeded` 才显示 CLEANED/DELETED/RESTORED/UNPUBLISHED，并允许相应的凭据轮换。PLANNED、DISPATCHING、OUTCOME_UNKNOWN 均保持 `MAINTENANCE_*`。
- 最后一个 maintenance step=`FAILED` 时显示该终态错误，不能回退到原 publication Job 推断状态；remote `needs_attention` 继续显示 `NEEDS_RECONCILIATION`。

## 已完成验收与清理

staging ARTICLE 与 CASE 各一个对象、各一次逻辑 publish，真实 reply-loss/restart recovery、raw SSR 和图片验证均 PASS；两对象均由各自受控 acceptance run purge。原 staging 配置字节及 owner 已恢复，新建 grant keys 已移除。站点既有 Basic Auth 保留，所以匿名 fidelity 为 401 warning；认证 raw SSR 与图片 HTTP 200 通过。

production 使用普通安装版 UI 完成唯一对象与唯一 publish，随后执行 unpublish → delete → restore → delete，最终页面 404，业务 active/published 仍为 84。该对象 `is_test=0`，正式 API 没有 purge 权限；禁止伪造 purge。三张合成媒体按既有服务保留策略继续存在。

本地既有 64 张表和业务行均保留。验收收尾仅通过 Main 已有 `accounts:update` 恢复一次 Douyin enabled 开关，两条审计时间戳因此如实变化；没有发生登录或发布，既有加密 credential entries 均未改变。

不存在需要操作者补做的远端内容 cleanup、打包或真实验收。最终交付采用本地 commit/tag 和 clean 检查；私有 GitHub 推送等待 Owner 配置私有目标。不得重新运行 live acceptance 或创建替代 production 对象来“再确认”。
