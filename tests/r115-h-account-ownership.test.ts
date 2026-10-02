import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { openDatabase } from '@publisher/db';
import { AccountOnboarding } from '../apps/desktop/src/main/account-onboarding';

function fixture() {
  const { db, repository } = openDatabase(join(mkdtempSync(join(tmpdir(), 'r115-h-owner-')), 'publisher.db'), resolve('packages/db/migrations'));
  repository.seedPlatformCatalog(resolve('PLATFORMS.csv'));
  const a = repository.createBrand({ name: '合成甲', companyName: '合成甲公司' }), b = repository.createBrand({ name: '合成乙', companyName: '合成乙公司' });
  const account = repository.createAccount({ platformKey: 'weibo', name: '合成甲公司同名账号' });
  const articles = [a, b].map(company => repository.createArticle({ brandId: company.id, title: 'PRIVATE_ARTICLE_TITLE', body: 'PRIVATE_ARTICLE_BODY', topic: '', keyword: '', city: '', summary: '', tags: [], seoKeywords: [], articleType: 'article', aiProvider: 'manual', aiModel: 'fixture', generatedAt: 'fixture', reusePolicy: 'once', contentHash: randomUUID() })!);
  const onboarding = new AccountOnboarding(repository, { invalidateAuthentication: () => {} });
  const job = (articleId: string) => { const id = randomUUID(); db.prepare("INSERT INTO publish_jobs(id,account_id,platform_key,article_id,scheduled_at,status,created_at) VALUES(?,?,'weibo',?,'fixture','Cancelled','fixture')").run(id, account.id, articleId); return id; };
  const preview = () => onboarding.preview().find(row => row.accountId === account.id)!;
  return { db, repository, a, b, account, articles, onboarding, job, preview };
}

it('includes independent PublishRecord company references and exposes conflicts without auto assignment or private content', () => {
  const f = fixture(); try {
    const jobId = f.job(f.articles[0]!.id);
    f.db.prepare("INSERT INTO publish_records(id,job_id,account_id,platform_key,article_id,success,response_json,published_at,status) VALUES('record',?,?,'weibo',?,0,?,'fixture','Failed')").run(jobId, f.account.id, f.articles[1]!.id, JSON.stringify({ secret: 'PRIVATE_RESPONSE' }));
    const before = JSON.stringify(f.db.prepare('SELECT * FROM publish_records').all());
    const row = f.preview(); expect(row.confidence).toBe('CONFLICT'); expect(row.suggestedCompanyId).toBeNull();
    expect(row.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ companyId: f.b.id, recordCount: 1 })]));
    expect(JSON.stringify(row)).not.toContain('PRIVATE_');
    expect(f.db.prepare('SELECT COUNT(*) n FROM operations_account_company_bindings').get()).toEqual({ n: 0 });
    expect(JSON.stringify(f.db.prepare('SELECT * FROM publish_records').all())).toBe(before);
  } finally { f.db.close(); }
});

it('uses company-specific selected image metadata as weak evidence but excludes universal images', () => {
  const f = fixture(); try {
    const jobId = f.job(f.articles[0]!.id);
    f.db.prepare("INSERT INTO media_assets(id,brand_id,type,title,file_path,provider,metadata_json,created_at) VALUES('image',?,'image','PRIVATE_IMAGE','PRIVATE_PATH','local',?,'fixture')").run(f.b.id, JSON.stringify({ universal: false }));
    f.db.prepare("UPDATE publish_jobs SET selected_image_asset_id='image' WHERE id=?").run(jobId);
    expect(f.preview()).toMatchObject({ confidence: 'CONFLICT', suggestedCompanyId: null, currentCompanyId: null });
    expect(f.preview().evidence).toEqual(expect.arrayContaining([expect.objectContaining({ companyId: f.b.id, imageCount: 1, jobCount: 0 })]));
    expect(JSON.stringify(f.preview())).not.toContain('PRIVATE_');
    f.db.prepare("UPDATE media_assets SET metadata_json=? WHERE id='image'").run(JSON.stringify({ universal: true }));
    expect(f.preview()).toMatchObject({ confidence: 'LOW', suggestedCompanyId: f.a.id });
  } finally { f.db.close(); }
});

it('distinguishes historical use from explicit Owner confirmation and never infers ownership from names', () => {
  const f = fixture(); try {
    expect(f.preview()).toMatchObject({ confidence: 'NO_EVIDENCE', suggestedCompanyId: null });
    f.job(f.articles[0]!.id); expect(f.preview()).toMatchObject({ confidence: 'LOW', currentCompanyId: null });
    f.job(f.articles[0]!.id); expect(f.preview()).toMatchObject({ confidence: 'MEDIUM', currentCompanyId: null });
    f.onboarding.confirm({ accountId: f.account.id, companyId: f.a.id, expectedVersion: 0, expectedCompanyId: null });
    expect(f.preview()).toMatchObject({ confidence: 'HIGH', currentCompanyId: f.a.id, verificationState: 'UNVERIFIED' });
  } finally { f.db.close(); }
});

it('uses OfficialAPI source-company metadata without reading remote identities, journals or key identifiers', () => {
  const f = fixture(); try {
    const jobId = f.job(f.articles[0]!.id);
    f.db.prepare("INSERT INTO official_api_operations(job_id,account_id,source_article_id,site_id,environment,key_id,source_hash,content_binding_id,phase,journal_json,created_at,updated_at) VALUES(?,?,?,'synthetic','staging','PRIVATE_KEY_ID',?,?,'FAILED',?,'fixture','fixture')")
      .run(jobId, f.account.id, f.articles[1]!.id, 'a'.repeat(64), 'b'.repeat(64), JSON.stringify({ private: 'PRIVATE_JOURNAL' }));
    expect(f.preview()).toMatchObject({ confidence: 'CONFLICT', suggestedCompanyId: null });
    expect(f.preview().evidence).toEqual(expect.arrayContaining([expect.objectContaining({ companyId: f.b.id, officialOperationCount: 1 })]));
    expect(JSON.stringify(f.preview())).not.toContain('PRIVATE_');
  } finally { f.db.close(); }
});
