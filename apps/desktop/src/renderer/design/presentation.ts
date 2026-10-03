import type { OwnershipConfidence } from '../../shared/account-onboarding';

/** Read-only copy. It cannot confirm ownership, alter a gate or invoke IPC. */
export function ownershipPresentation(item: { currentCompanyName: string | null; suggestedCompanyName: string | null; confidence: OwnershipConfidence; conflictReason: string | null }): {
  current: string; suggested: string; currentTone: string; attentionTone: string; attention: string;
} {
  return {
    current: item.currentCompanyName ?? '尚未确认',
    suggested: item.suggestedCompanyName ? `${item.suggestedCompanyName} · 待 Owner 确认` : '暂无可靠建议，请 Owner 选择',
    currentTone: item.currentCompanyName ? 'success' : 'warning',
    attentionTone: item.confidence === 'CONFLICT' ? 'danger' : ['NO_EVIDENCE', 'LOW', 'MEDIUM'].includes(item.confidence) ? 'warning' : 'muted',
    attention: item.conflictReason ?? (item.confidence === 'NO_EVIDENCE' ? '没有足够历史证据，保持未确认。' : item.confidence === 'LOW' ? '线索有限，需要人工核对。' : item.confidence === 'MEDIUM' ? '存在关系线索，尚不代表企业归属。' : '关系建议与已确认归属分别展示。'),
  };
}

export function preflightPresentation(result: { allowed: boolean; items: ReadonlyArray<{ passed: boolean; label: string; value: string }>; blockers: readonly string[] }): { title: string; tone: string; passed: number; total: number; blockers: readonly string[] } {
  return { title: result.allowed ? '发布预检通过' : '还需处理发布条件', tone: result.allowed ? 'success' : 'warning', passed: result.items.filter(item => item.passed).length, total: result.items.length, blockers: result.blockers };
}

export function jobStateDescription(status: string): string {
  if (['Prepared', 'DryRunPassed'].includes(status)) return '内容准备完成，等待后续确认。';
  if (status === 'AwaitingConfirmation') return '等待本人核对并确认。';
  if (['Submitting', 'Publishing', 'Running'].includes(status)) return '平台处理中，请等待原任务结果。';
  if (['Unknown', 'NeedsReconciliation', 'SubmittedUnknown'].includes(status)) return '结果未知，请勿重发；先核对原任务。';
  if (['Published', 'Success'].includes(status)) return '结果已记录，详情以原任务回执为准。';
  if (status === 'Failed') return '处理失败，请查看原因后按原流程处理。';
  if (status === 'Cancelled') return '任务已停止，历史记录保留。';
  return '查看任务详情，按当前状态处理。';
}

export const publishWorkflowLabels = ['内容', '平台版本', '人工审核', '账号', '预检', '发布', '结果'] as const;

/** H delivery obligations, deliberately not presented as live runtime checks. */
export const ownerReleaseChecklist = [
  { priority: 'must', title: '历史素材缺失', detail: 'H 交付记录中有 2 个历史图片文件缺失。完整私有素材恢复尚未通过。', risk: '恢复前核对原始来源；保留原记录，素材可能不完整。', next: 'Owner 核对原文件与备份来源', route: 'backups' },
  { priority: 'must', title: '历史账号归属', detail: 'H 基线的 28 个历史账号仍未确认企业归属。建议关系不等于已绑定。', risk: '使用账号前逐项核对；错误归属会影响企业隔离。', next: '在下方逐项核对账号归属', route: null },
  { priority: 'must', title: '微博正常登录', detail: '使用微博账号前，需 Owner 正常登录并核对当前身份。', risk: '未验证会话不能作为发布资格；平台开放能力仍由原门禁决定。', next: '前往账号中心核对', route: 'accounts' },
  { priority: 'must', title: '搜狐 Creator 登录', detail: '使用搜狐 Creator 账号前，需 Owner 正常登录并核对当前身份。', risk: '未验证会话不能作为发布资格；平台开放能力仍由原门禁决定。', next: '前往账号中心核对', route: 'accounts' },
  { priority: 'suggested', title: '博客园连接凭据', detail: '如需使用博客园，Owner 在软件安全输入框中配置 PAT。', risk: '不要写入文档或聊天；连接和平台能力仍需单独验证。', next: '前往账号中心配置', route: 'accounts' },
  { priority: 'suggested', title: '异地备份目标', detail: 'Owner 选择受控的异地备份位置，并进行独立恢复演练。', risk: '本机副本不能证明异地灾备已完成。', next: '查看备份与恢复', route: 'backups' },
  { priority: 'later', title: '安装包签名证书', detail: '当前 Candidate 未配置正式代码签名证书；广泛分发前需处理。', risk: 'Windows 可能显示未知发布者；签名状态需由交付证据确认。', next: '查看当前版本', route: 'preferences' },
] as const;
