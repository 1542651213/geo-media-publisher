import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it, vi } from 'vitest';
import { openDatabase } from '@publisher/db';
import { listWorkspaceJobs } from '../apps/desktop/src/main/workspace-jobs';

it('returns the complete current-company history with constant reads and preserves the frozen rows', () => {
  const root = mkdtempSync(join(tmpdir(), 'geo-workspace-jobs-'));
  const { db, repository } = openDatabase(join(root, 'publisher.db'), resolve('packages/db/migrations'));
  try {
    repository.seedPlatformCatalog(resolve('PLATFORMS.csv'));
    const companies = ['甲', '乙'].map(name => repository.createBrand({ name: '任务合成' + name, companyName: '任务合成' + name + '公司' }));
    const articles = companies.map((company, index) => repository.createArticle({ brandId: company.id, title: '任务源稿' + index, body: '合成工作区任务正文', topic: '合成', keyword: '', city: '', summary: '', tags: [], seoKeywords: [], articleType: 'article', aiProvider: 'manual', aiModel: 'fixture', generatedAt: 'fixture', reusePolicy: 'once', contentHash: 'workspace-job-' + index })!);
    const account = repository.createAccount({ platformKey: 'weibo', name: '任务合成账号' });
    const insert = db.prepare("INSERT INTO publish_jobs(id,account_id,platform_key,article_id,scheduled_at,status,created_at) VALUES(?,?,'weibo',?,?,'Cancelled','fixture')");
    db.transaction(() => { for (let index = 0; index < 1000; index++) insert.run('synthetic-job-' + index, account.id, articles[index % 2]!.id, String(index).padStart(4, '0')); })();
    const frozen = JSON.stringify(repository.listJobs());
    const current = vi.fn(() => companies[0]!.id), prepared = vi.spyOn(db, 'prepare'), articleReads = vi.spyOn(repository, 'getArticle');
    const a = listWorkspaceJobs(repository, { current });
    expect(a).toHaveLength(500);
    expect(a.every(job => job.articleId === articles[0]!.id)).toBe(true);
    expect(current).toHaveBeenCalledTimes(1);
    expect(articleReads).not.toHaveBeenCalled();
    expect(prepared.mock.calls.length).toBeLessThanOrEqual(1);
    prepared.mockClear(); current.mockClear(); current.mockReturnValue(companies[1]!.id);
    const b = listWorkspaceJobs(repository, { current }, { status: 'Cancelled' });
    expect(b).toHaveLength(500);
    expect(b.every(job => job.articleId === articles[1]!.id)).toBe(true);
    expect(b[0]!.scheduledAt < b.at(-1)!.scheduledAt).toBe(true);
    expect(current).toHaveBeenCalledTimes(1);
    expect(articleReads).not.toHaveBeenCalled();
    expect(prepared.mock.calls.length).toBeLessThanOrEqual(1);
    vi.restoreAllMocks();
    expect(JSON.stringify(repository.listJobs())).toBe(frozen);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(db.pragma('foreign_key_check')).toEqual([]);
  } finally { vi.restoreAllMocks(); db.close(); }
});

it('does not load any jobs when no company is selected', () => {
  const root = mkdtempSync(join(tmpdir(), 'geo-workspace-jobs-empty-'));
  const { db, repository } = openDatabase(join(root, 'publisher.db'), resolve('packages/db/migrations'));
  try {
    const query = vi.spyOn(repository, 'listJobs'), current = vi.fn(() => null);
    expect(listWorkspaceJobs(repository, { current })).toEqual([]);
    expect(current).toHaveBeenCalledTimes(1);
    expect(query).not.toHaveBeenCalled();
  } finally { vi.restoreAllMocks(); db.close(); }
});
