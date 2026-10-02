import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it, vi } from 'vitest';
import { openDatabase } from '@publisher/db';
import { pageWorkspaceJobs } from '../apps/desktop/src/main/workspace-jobs';
import { readOperationsReviewItems } from '../apps/desktop/src/main/operations-review-read-model';

function fixture() {
  const { db, repository } = openDatabase(join(mkdtempSync(join(tmpdir(), 'h-jobs-page-')), 'publisher.db'), resolve('packages/db/migrations'));
  repository.seedPlatformCatalog(resolve('PLATFORMS.csv'));
  const brands = ['甲', '乙'].map(name => repository.createBrand({ name: '合成' + name, companyName: '合成' + name + '公司' }));
  const account = repository.createAccount({ platformKey: 'weibo', name: 'PRIVATE_OTHER_COMPANY_ACCOUNT' });
  const articles = brands.map((brand, index) => repository.createArticle({ brandId: brand.id, title: '合成稿' + index, body: 'PRIVATE_BODY', topic: '', keyword: '', city: '', summary: '', tags: [], seoKeywords: [], articleType: 'article', aiProvider: 'manual', aiModel: 'fixture', generatedAt: 'fixture', reusePolicy: 'once', contentHash: 'page-fixture-' + index })!);
  db.prepare("INSERT INTO operations_account_company_bindings(account_id,company_id,bound_at,updated_at,version) VALUES(?,?,'fixture','fixture',1)").run(account.id, brands[1]!.id);
  const insert = db.prepare("INSERT INTO publish_jobs(id,account_id,platform_key,article_id,scheduled_at,status,created_at,publish_payload_json) VALUES(?,?,'weibo',?,?,'Cancelled','2026-10-03T00:00:00.000Z',?)");
  db.transaction(() => { for (let index = 0; index < 222; index++) insert.run('job-' + String(index).padStart(3, '0'), account.id, articles[index % 2]!.id, '2026-10-03', JSON.stringify({ private: 'PRIVATE_FROZEN_PAYLOAD' })); })();
  return { db, repository, brands, account, articles };
}

it('returns bounded summary pages, exact totals and stable complete history inside the Main-owned company', () => {
  const f = fixture(); try {
    const before = JSON.stringify(f.repository.listJobs()), current = vi.fn(() => f.brands[0]!.id);
    const first = pageWorkspaceJobs(f.repository, { current }, { page: 1, pageSize: 50 });
    expect(first).toMatchObject({ total: 111, pages: 3, page: 1, pageSize: 50, companyId: f.brands[0]!.id }); expect(first.items).toHaveLength(50); expect(current).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(first)).not.toContain('PRIVATE_');
    const all = [first, pageWorkspaceJobs(f.repository, { current }, { page: 2 }), pageWorkspaceJobs(f.repository, { current }, { page: 3 })].flatMap(page => page.items);
    expect(new Set(all.map(item => item.id)).size).toBe(111); expect(all.every(item => item.title === '合成稿0')).toBe(true);
    expect(pageWorkspaceJobs(f.repository, { current }, { page: 100 }).page).toBe(3);
    expect(pageWorkspaceJobs(f.repository, { current }, { pageSize: 5000 }).items.length).toBeLessThanOrEqual(100);
    expect(JSON.stringify(f.repository.listJobs())).toBe(before);
  } finally { f.db.close(); }
});

it('filters fresh Owner status without a stale cache and rejects renderer-selected company scope', () => {
  const f = fixture(); try {
    const current = () => f.brands[0]!.id;
    expect(pageWorkspaceJobs(f.repository, { current }, { ownerOnly: true }).total).toBe(0);
    f.db.prepare("UPDATE publish_jobs SET status='NeedsReconciliation' WHERE id='job-000'").run();
    expect(pageWorkspaceJobs(f.repository, { current }, { ownerOnly: true, date: '2026-10-03', platform: 'weibo' })).toMatchObject({ total: 1, items: [{ id: 'job-000', ownerActionRequired: true }] });
    expect(() => pageWorkspaceJobs(f.repository, { current }, { brandId: f.brands[1]!.id })).toThrow();
    expect(pageWorkspaceJobs(f.repository, { current: () => null }, {}).items).toEqual([]);
  } finally { f.db.close(); }
});

it('reads review metadata in one query and invalidates stale approved hashes without loading article bodies or review journals', () => {
  const f = fixture(); try {
    const article = f.articles[0]!;
    f.db.prepare("UPDATE content_quality_states SET status='Approved',content_hash=?,updated_at='2026-10-03' WHERE content_type='article' AND content_id=?").run(article.contentHash, article.id);
    const spy = vi.spyOn(f.db, 'prepare');
    expect(readOperationsReviewItems(f.repository, f.brands[0]!.id)).toMatchObject([{ articleId: article.id, reviewStatus: 'Approved' }]); expect(spy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(readOperationsReviewItems(f.repository, f.brands[0]!.id))).not.toContain('PRIVATE_'); spy.mockRestore();
    f.db.prepare("UPDATE articles SET content_hash='changed' WHERE id=?").run(article.id);
    expect(readOperationsReviewItems(f.repository, f.brands[0]!.id)).toMatchObject([{ articleId: article.id, reviewStatus: 'Draft' }]);
    expect(readOperationsReviewItems(f.repository, f.brands[1]!.id).every(row => row.companyId === f.brands[1]!.id)).toBe(true);
  } finally { vi.restoreAllMocks(); f.db.close(); }
});
