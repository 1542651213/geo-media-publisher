import { nav, tab } from './r115-h-installed-helpers.mjs';

export function visualRoutes(page) {
  return [
    ['01-home', async () => { await nav(page, '首页'); await tab(page, '今日工作台'); }],
    ['02-ai', async () => { await nav(page, '内容生产'); }],
    ['03-articles', async () => { await nav(page, '文章库'); await page.locator('.v11-article-row').first().waitFor(); }],
    ['04-enterprise', async () => { await nav(page, '内容生产'); await tab(page, '企业 AI 资料'); }],
    ['05-accounts', async () => { await nav(page, '账号中心'); await page.locator('.v11-account-card').first().waitFor(); }],
    ['06-account-ownership', async () => { await nav(page, '内容运营'); await tab(page, 'Owner 处理'); await page.locator('.owner-account-card').first().waitFor(); await page.getByRole('region', { name: '账号归属一页确认' }).evaluate(el => el.scrollIntoView({ block: 'start' })); }],
    ['07-publish', async () => { await nav(page, '发布中心'); }],
    ['08-jobs', async () => { await nav(page, '内容运营'); await tab(page, '发布看板'); await page.getByText('共 1 条 · 第 1 / 1 页', { exact: true }).waitFor(); }],
    ['09-owner', async () => { await nav(page, '内容运营'); await tab(page, 'Owner 处理'); await page.locator('.owner-account-card').first().waitFor(); }],
    ['10-backup', async () => { await nav(page, '高级功能'); await page.locator('.v11-advanced-grid button').filter({ hasText: '数据备份' }).click(); await page.getByRole('heading', { name: '备份与隔离恢复', exact: true }).waitFor(); await page.getByRole('heading', { name: '备份与隔离恢复', exact: true }).evaluate(el => el.closest('.page-title').scrollIntoView({ block: 'start' })); }],
    ['11-settings', async () => { await nav(page, '设置'); await page.getByRole('heading', { name: '关于此版本', exact: true }).waitFor(); }],
  ];
}
