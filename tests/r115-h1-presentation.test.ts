import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ownershipPresentation, preflightPresentation, jobStateDescription } from '../apps/desktop/src/renderer/design/presentation';

describe('H1 presentation preserves uncertainty and human approval', () => {
  it('does not turn a strong ownership suggestion into a confirmed binding', () => {
    const item = ownershipPresentation({ currentCompanyName: null, suggestedCompanyName: '示例甲', confidence: 'HIGH', conflictReason: null });
    expect(item.current).toContain('尚未确认');
    expect(item.suggested).toContain('待 Owner 确认');
    expect(item.currentTone).toBe('warning');
  });
  it('keeps conflicts prominent even when a company is currently bound', () => {
    const item = ownershipPresentation({ currentCompanyName: '甲', suggestedCompanyName: '乙', confidence: 'CONFLICT', conflictReason: '跨企业证据' });
    expect(item.attentionTone).toBe('danger');
    expect(item.attention).toBe('跨企业证据');
    expect(item.current).toBe('甲');
  });
  it('keeps no evidence and low confidence as attention states', () => {
    for (const confidence of ['NO_EVIDENCE', 'LOW', 'MEDIUM'] as const) expect(ownershipPresentation({ currentCompanyName: null, suggestedCompanyName: null, confidence, conflictReason: null }).attentionTone).toBe('warning');
  });
  it('reports the existing Main verdict rather than inferring permission from passed checks', () => {
    const result = preflightPresentation({ allowed: false, items: [{ passed: true, label: '企业', value: '甲' }], blockers: ['身份尚未核实'] });
    expect(result.tone).toBe('warning');
    expect(result.title).toBe('还需处理发布条件');
    expect(result.passed).toBe(1);
    expect(result.blockers).toEqual(['身份尚未核实']);
  });
  it('never describes prepared, submitting or unknown states as published', () => {
    for (const state of ['Prepared', 'AwaitingConfirmation', 'Submitting', 'Publishing', 'NeedsReconciliation', 'Unknown']) expect(jobStateDescription(state)).not.toContain('已发布');
    expect(jobStateDescription('Unknown')).toContain('请勿重发');
    expect(jobStateDescription('Cancelled')).toContain('已停止');
  });
});

describe('H1 core text contrast', () => {
  const luminance = (hex: string): number => {
    const channels = hex.slice(1).match(/../gu)!.map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  };
  it('keeps normal primary, secondary and semantic text at WCAG AA on a white surface', () => {
    const css = readFileSync(new URL('../apps/desktop/src/renderer/design/tokens.css', import.meta.url), 'utf8');
    for (const name of ['text-primary', 'text-secondary', 'color-primary', 'success-text', 'warning-text', 'danger-text']) {
      const color = new RegExp(`--${name}:\\s*(#[a-fA-F0-9]{6})`).exec(css)?.[1];
      expect(color, name).toBeTruthy();
      expect((1.05 / (luminance(color!) + .05)), name).toBeGreaterThanOrEqual(4.5);
    }
  });
});
