import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { openDatabase } from '@publisher/db';
import { exportColleaguePackage, importColleaguePackage } from '../apps/desktop/src/main/colleague-data-package';
import { AIProductCenter } from '../apps/desktop/src/main/ai-product-center';
import { ContentOperations } from '../apps/desktop/src/main/content-operations';

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach(close => close()));
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'r115-h-colleague-'));
  const { repository, db } = openDatabase(join(root, 'publisher.db'), resolve('packages/db/migrations'));
  cleanup.push(() => { db.close(); rmSync(root, { recursive: true, force: true }); });
  const company = repository.createBrand({ name: '合成企业', companyName: '合成企业' });
  const article = repository.createArticle({ brandId: company.id, title: '已审内容', body: '合成正文', topic: '合成', keyword: '', city: '', summary: '', tags: [], seoKeywords: [], articleType: 'article', aiProvider: 'manual', aiModel: '', generatedAt: new Date().toISOString(), reusePolicy: 'once', contentHash: 'current-content' })!;
  const selection = { companyId: company.id, articleIds: [article.id], assetIds: [], includeTemplates: false, includeFacts: true };
  const identity = { appVersion: '1.1.9', deliveryId: 'R1.15-H' };
  return { root, repository, db, company, article, selection, identity };
}
it('refuses unreviewed and stale approval before creating an export directory', () => {
  const { root, db, repository, article, selection, identity } = fixture();
  const destination = join(root, 'package');
  expect(() => exportColleaguePackage(repository, selection, destination, identity)).toThrow('尚未人工审核');
  expect(existsSync(destination)).toBe(false);
  db.prepare("UPDATE content_quality_states SET status='Approved',content_hash='old-content' WHERE content_id=?").run(article.id);
  expect(() => exportColleaguePackage(repository, selection, destination, identity)).toThrow('尚未人工审核');
  db.prepare("UPDATE content_quality_states SET content_hash=? WHERE content_id=?").run(article.contentHash, article.id);
  expect(exportColleaguePackage(repository, selection, destination, identity).articleCount).toBe(1);
});
it('shares only approved current facts without private notes and imports all facts unapproved', () => {
  const { root, db, repository, company, article, selection, identity } = fixture();
  db.prepare("UPDATE content_quality_states SET status='Approved' WHERE content_id=?").run(article.id);
  const insert = db.prepare("INSERT INTO operations_facts(id,company_id,category,statement,source,verified_at,expires_at,approved_for_ai,notes,created_at,updated_at) VALUES(?,?,'资质',?,'Manual',?,?,?,'PRIVATE_NOTE_EXCLUDED','2026-01-01','2026-01-01')");
  insert.run('approved', company.id, '可共享事实', '2026-01-01', null, 1);
  insert.run('unapproved', company.id, '未审事实', '2026-01-01', null, 0);
  insert.run('unverified', company.id, '未核实事实', null, null, 1);
  insert.run('expired', company.id, '过期事实', '2020-01-01', '2021-01-01', 1);
  const directory = join(root, 'package');
  const exported = exportColleaguePackage(repository, selection, directory, identity);
  expect(exported.factCount).toBe(1);
  const manifest = readFileSync(join(directory, 'manifest.json'), 'utf8');
  expect(manifest).not.toMatch(/PRIVATE_NOTE_EXCLUDED|未审事实|未核实事实|过期事实/u);
  const imported = importColleaguePackage(repository, directory, join(root, 'assets'));
  expect(db.prepare('SELECT statement,approved_for_ai,verified_at FROM operations_facts WHERE company_id=?').all(imported.companyId)).toEqual([{ statement: '可共享事实', approved_for_ai: 0, verified_at: null }]);
  expect(repository.getContentQualityState('article', repository.listArticles({ brandId: imported.companyId })[0]!.id)?.status).toBe('Draft');
  const center=new AIProductCenter(repository,{get:()=>null,set:()=>{},delete:()=>{},has:()=>false},async()=>{throw new Error('NO_NETWORK_ALLOWED');}),operations=new ContentOperations(repository,center);
  const fact=operations.snapshot(imported.companyId).facts[0]!;
  expect(operations.activeFacts(imported.companyId)).toHaveLength(0);
  const input={id:fact.id,companyId:imported.companyId,category:fact.category,statement:fact.statement,source:fact.source,sourceDate:fact.sourceDate,verifiedAt:new Date().toISOString(),expiresAt:null,approvedForAI:true,notes:''};
  expect(()=>operations.saveFact({...input,companyId:company.id})).toThrow('当前企业不匹配');
  operations.saveFact(input);
  expect(operations.snapshot(imported.companyId).facts).toHaveLength(1);
  expect(operations.activeFacts(imported.companyId)[0]?.id).toBe(fact.id);
});
