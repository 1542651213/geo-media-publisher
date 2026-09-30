# OfficialAPI SiteConfig 扩展模板

Kangyi 是当前已完成实现与双环境验收的 OfficialAPI V2 参考站点。新站点必须复用通用 OfficialApiAdapter 和 durable runtime；禁止复制品牌 Adapter、把 URL 作为自由输入，或因 Kangyi 已通过而推断其它站点兼容。

## 每个站点必须声明

- 固定 siteId、品牌身份、staging / production 精确 HTTPS origin。
- 独立 SafeStorage credential refs、principal、environment 和 protocolVersion。
- 实际 contentKinds、taxonomy、必填字段、字段上限、媒体类型与 limits。
- health/capabilities 的签名读回规则和 writesEnabled 解释。
- create/draft/validate/publish/maintenance 各动作的权限与返回 binding。
- test-only 对象的授权来源、额度、到期、cleanup 和 purge 资格。
- public URL 允许的 origin/path，以及 Basic Auth、CDN 或其它公开读取条件。

Renderer 只接收 metadata 和受控选择项。secret、凭据文件路径、exact JSON、raw local path 和 durable journal 保留在 Main。每次 prepare 与 final 前必须重新验证账号、site、environment、协议、kind、writes 和当前 grant validity。

## 必须继承的安全语义

- HMAC 为精确 8 行 LF canonical input；secret 使用原始 UTF-8。
- 写请求一次；GET 才允许有界重试。
- immutable source/scope/settings/media/content binding 在 cleanup 前不变。
- HTTP 202 不是 Published；原 exact Job=`succeeded` 且返回可信同 scope `publicUrl` 才能确认 Publish Success。raw SSR、media 与 public readback 独立记录 `PublicContentVerified=PASS/FAIL/LIMITED`，fidelity 失败不授权重发。
- SubmissionIntent final counter 是唯一最终边界；final 后永不 Retry。
- ordinary publish 与 batch publish 分开控制；一个站点通过不自动开启另一个站点。
- 维护只接受本地 existing job，remote identity 由 journal 派生；调用者不能提供 remote ID 或 purge authority。

## 恢复能力清单

新站点接入前必须逐项核实：

1. idempotency cache 的期限、scope、method/target/key/body 绑定。
2. 原 publish 响应丢失后，如何证明原请求不可能再次执行。Kangyi 使用 48 小时 cache 加严格 original-version fence；其它站点不能未经证明照搬。
3. media POST 首次响应丢失后，是否存在只读 operation/media lookup。没有 mediaId 且没有查询接口时必须记录 `ARCHITECTURE_GAP`，不能重新上传。
4. maintenance Job 的 content/revision/hash binding 是否可空。Kangyi 当前要求持久化并核对精确 null binding；缺失 binding 的非终态旧 journal fail closed。已有 local `SUCCEEDED`、remote `succeeded` 和读回证据的历史维护保持终态，不重新轮询。
5. restore、delete、unpublish、purge 的实际终态和版本变化。local step 与 remote Job 必须同时 succeeded 才是成功终态；最后一步 `FAILED` 显示自身错误，不回退到 publication Job；remote `needs_attention` 保持 `NEEDS_RECONCILIATION`。
6. purge 是否由服务器验证 task ownership、deleted、acceptanceRunId 或其它明确授权。`writesEnabled=true` 永远不够。

## 当前多站点状态

目前 SiteConfig 仍只有 `KANGYI_SITE_CONFIG` 作为已验收实现。Huiquan / Shupai 没有修改、配置、连接、发布或策略激活；模板本身也不激活它们。接入这两个站点前，必须读取各自实际部署合同、建立独立 whitelist/SafeStorage scope，并分别完成离线、staging、production 和 cleanup 验收。

Kangyi 的生产验收保留了三张合成媒体，因为现有正式服务策略不允许随 normal `is_test=0` 内容 purge。新站点必须把媒体生命周期写入自己的合同，不能默认内容 delete 会删除媒体。
