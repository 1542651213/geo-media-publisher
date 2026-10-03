import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { EnterpriseProfileManager } from '../apps/desktop/src/renderer/EnterpriseProfileManager';

it('provides the first-company form in the ordinary empty enterprise workspace', () => {
  const html = renderToStaticMarkup(createElement(EnterpriseProfileManager, { initialView: 'profile', refresh: () => {}, onNavigate: () => {} }));
  expect(html).toContain('aria-label="新企业名称"');
  expect(html).toContain('aria-label="新企业简称"');
  expect(html).toMatch(/<button[^>]*>创建企业<\/button>/u);
  expect(html).not.toContain('请先在高级功能中创建企业');
});
