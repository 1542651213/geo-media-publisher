import { describe, expect, it } from 'vitest';
import { ownerReleaseChecklist, ownershipPresentation } from '../apps/desktop/src/renderer/design/presentation';

describe('H2 Owner review keeps delivery obligations explicit and conditional', () => {
  it('retains seven separate obligations including both normal platform logins', () => {
    expect(ownerReleaseChecklist).toHaveLength(7);
    expect(ownerReleaseChecklist.map(item => item.title)).toContain('微博正常登录');
    expect(ownerReleaseChecklist.map(item => item.title)).toContain('搜狐 Creator 登录');
    expect(ownerReleaseChecklist.find(item => item.title === '历史素材缺失')?.detail).toContain('2 个');
    expect(ownerReleaseChecklist.find(item => item.title === '历史账号归属')?.detail).toContain('28 个');
    expect(ownerReleaseChecklist.every(item => item.risk && item.next)).toBe(true);
  });
  it('gives every inherited item an explicit priority without claiming it passed', () => {
    const priorities = ownerReleaseChecklist.map(item => 'priority' in item ? item.priority : undefined);
    expect(priorities).not.toContain(undefined);
    expect(new Set(priorities)).toEqual(new Set(['must', 'suggested', 'later']));
    expect(ownerReleaseChecklist.every(item => !('passed' in item))).toBe(true);
  });
  it('describes absent ownership in employee language while leaving evidence uncertain', () => {
    const view = ownershipPresentation({ currentCompanyName: null, suggestedCompanyName: '示例乙', confidence: 'HIGH', conflictReason: null });
    expect(view.current).toBe('尚未确认');
    expect(view.suggested).toContain('待 Owner 确认');
    expect(view.currentTone).toBe('warning');
  });
});
