# Task10S — Xiaohongshu One-Shot Real Publish Acceptance Design

## Goal

在保留 Task10R 探索能力和 final-submit fail-closed 保护的前提下，为唯一指定的小红书测试账号增加一次性、操作级、可审计的真实发布授权路径；本轮只实现、验证、打包和提交，不部署、不执行 live 操作。

## Scope and hard boundary

- platformKey 固定为 `xiaohongshu`。
- accountId 固定为 `54b390ac-d81e-440a-baeb-d00f9f346cc3`。
- mode 固定为 `ONE_SHOT_REAL_PUBLISH_ACCEPTANCE`。
- authorization literal 固定为 `OWNER_AUTHORIZED_ONE_SHOT_TEST_PUBLISH`。
- 授权状态为 `NOT_AUTHORIZED`、`AUTHORIZED_UNUSED`、`CONSUMED`；final-submit action 开始前以原子方式消费授权。
- `MAX_PUBLICATION_TRANSACTIONS = 1`、`MAX_FINAL_SUBMIT_ATTEMPTS = 1`、`FINAL_SUBMIT_RETRY_COUNT = 0`。
- 同一确认 modal 最多允许一个额外 commit action，总 commit action 不超过 2；它不是新的 publish retry。
- Task10R exploration 永远保持 `FINAL_SUBMIT_COUNT = 0`，没有 Task10S 授权时永远不能进入真实 final-submit。
- 所有真实发布仍通过持久化 Job、SubmissionIntent、PublishRecord 生命周期；不手工伪造 Published/Verified。
- 本轮 live counters 全为 0，不能触碰 active installed runtime。

## Architecture

### 1. Typed authorization and guard

在 domain/core 增加小红书 one-shot authorization record、严格绑定校验、preflight evidence、post-submit observation、reconciliation 和 `OneShotPublicationGuard`。guard 是唯一允许调用真实 final-submit locator 的 authority：它在一次 final-submit action 开始前校验 authorization、operation/account/platform、canonical Context/Page、认证、编辑器、safe fixture、标题正文 readback、required fields 和 final control；随后原子消费授权，再执行一次 locator click。guard 记录 transaction、attempt、commit-action 和 retry counters，任何异常都保持 consumed。

### 2. Persistent lifecycle and XHS adapter

增加 migration 和 repository 的 one-shot authorization 原子状态更新。XHS adapter 复用 Task10R 的 canonical page、bounded exploration、intermediate actions、标题/正文 readback 和 required settings；Task10S 只在 exploration 已抵达唯一可用 final control 后通过 `OneShotPublicationGuard` 执行提交。确认 modal 只接受当前 modal 内唯一、高置信、可见、启用且 hit-test 有效的候选。提交后只做 bounded observation；未知结果进入 `NeedsReconciliation`，不重新提交。

### 3. Owner entry and evidence

增加独立的 Task10S request/confirm/cancel IPC/API/UI 入口。request 只展示“本次会真实发布 1 条测试笔记，最多提交一次。”；只有 Owner confirm 才创建 `AUTHORIZED_UNUSED`。confirm 后创建持久化 Job 和 Prepared PublishRecord，并交给 PublisherService 的正式 queue execution；取消不创建授权、不执行提交。结构化 evidence 使用字段名记录授权、preflight、transaction、commit action、submit attempt、observation、reconciliation、external ID/URL 和 public verification，不用 substring 统计。

## Safety invariants

1. Task10R exploration 路径不接收 one-shot authorization，final submit remains read-only。
2. wrong platform/account/mode/operation、auth lost、Context/Page mismatch、mutex loss、login/security page、phase/control/readback/settings failure 都在 guard 前失败。
3. guard consumes before the first side-effect callback and locator click; timeout、URL unchanged、toast missing、unknown 都不能恢复授权或 retry。
4. confirmation modal 只能作为同一 transaction 的第二 commit action；unrelated modal 不点击。
5. 禁止 `form.submit`、`requestSubmit`、Enter/keyboard submit、synthetic submit event 和 direct network publication bypass。
6. 本轮不启动 XHS、不上传、不填充、不部署、不修改 production DB。

## Verification

- TDD focused tests first: authorization bindings/consumption, preflight, confirmation modal, no-retry, observation/reconciliation and Task10R regression.
- Full tests, typecheck, lint, build。
- Static packaged marker audit confirms Task10S and Task10R safety markers。
- Package to a new `release-task10s-20260901-r1` staging directory only。
- Post-package runtime precheck is read-only; active installed runtime means deployment is `BLOCKED_ACTIVE_RUNTIME`。
