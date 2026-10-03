import type { OwnershipConfidence } from '../../shared/account-onboarding';

/** Read-only copy. It cannot confirm ownership, alter a gate or invoke IPC. */
export function ownershipPresentation(item: { currentCompanyName: string | null; suggestedCompanyName: string | null; confidence: OwnershipConfidence; conflictReason: string | null }): {
  current: string; suggested: string; currentTone: string; attentionTone: string; attention: string;
} {
  return {
    current: item.currentCompanyName ?? '尚未确认 · UNASSIGNED',
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
  { title: '历史素材缺失', detail: 'H 交付记录中有 2 个历史图片文件缺失。完整私有素材恢复尚未通过。', risk: '恢复后的素材可能不完整；保留原记录，核对原始来源。', next: 'Owner 核对原文件与备份来源', route: 'backups' },
  { title: '历史账号归属', detail: 'H 基线的 28 个历史账号仍未确认企业归属。建议关系不等于已绑定。', risk: '错误归属会影响企业隔离；逐账号核对后明确确认。', next: '在下方逐项核对账号归属', route: null },
  { title: '微博与搜狐登录', detail: '需 Owner 完成微博和搜狐 Creator 的正常登录及身份检查。', risk: '未验证会话不能作为发布资格。', next: '前往账号中心核对', route: 'accounts' },
  { title: '博客园连接凭据', detail: 'Owner 提供并在软件安全输入框中配置 PAT；不要写入文档或聊天。', risk: '连接和平台能力仍需单独验证。', next: '前往账号中心配置', route: 'accounts' },
  { title: '异地备份目标', detail: 'Owner 选择受控的异地备份位置，并进行独立恢复演练。', risk: '本机副本不能证明异地灾备已完成。', next: '查看备份与恢复', route: 'backups' },
  { title: '安装包签名证书', detail: '当前 Candidate 未配置正式代码签名证书。', risk: 'Windows 可能显示未知发布者；签名状态需由交付证据确认。', next: '查看当前版本', route: 'preferences' },
] as const;
