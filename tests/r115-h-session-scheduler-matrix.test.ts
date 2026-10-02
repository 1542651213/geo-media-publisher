import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it, vi } from 'vitest';
import { openDatabase } from '@publisher/db';
import { AdapterRegistry, type AccountSessionTarget, type BrowserSessionManager, type PlatformAdapter } from '@publisher/adapters-core';
import { TestPlatformAdapter } from '@publisher/adapters-test';
import { createConsoleLogger } from '@publisher/logger';
import { PersistentScheduler, PublisherService } from '@publisher/publisher';
import { AccountSessionRehydrationCoordinator } from '../apps/desktop/src/main/account-session-rehydration';
import { productPlatform } from '../apps/desktop/src/shared/product-platform-policy';

it.each([
  ['company', 'IDENTITY_MISMATCH', 'COMPANY_BINDING_CHANGED'],
  ['disable', 'DISABLED', 'ACCOUNT_DISABLED'],
  ['generation', 'UNVERIFIED', 'LOGIN_GENERATION_CHANGED']
])('runs normal Scheduler ticks through CHECKING and rejects a late result after %s changes', async (change, state, reasonCode) => {
  vi.useFakeTimers();
  const { repository, db } = openDatabase(join(mkdtempSync(join(tmpdir(), 'h-session-scheduler-')), 'publisher.db'), resolve('packages/db/migrations'));
  let scheduler: PersistentScheduler | undefined;
  try {
    repository.seedPlatformCatalog(resolve('PLATFORMS.csv'));
    const company = repository.createBrand({ name: '合成调度甲', companyName: '合成调度甲公司' }), other = repository.createBrand({ name: '合成调度乙', companyName: '合成调度乙公司' });
    const account = repository.createAccount({ platformKey: 'weibo', name: '合成账号' }); repository.updateAccount(account.id, { loginStatus: 'logged_in' });
    const article = repository.createArticle({ brandId: company.id, title: '合成', body: '合成正文', topic: '', keyword: '', city: '', summary: '', tags: [], seoKeywords: [], articleType: 'article', aiProvider: 'manual', aiModel: 'fixture', generatedAt: 'fixture', reusePolicy: 'once', contentHash: 'fixture' })!;
    db.prepare("INSERT INTO publish_jobs(id,account_id,platform_key,article_id,scheduled_at,status,created_at) VALUES('due',?,'weibo',?,'2000-01-01','Scheduled','fixture')").run(account.id, article.id);
    const frozen = JSON.stringify(repository.listJobs());
    const adapter = new TestPlatformAdapter(), registry = new AdapterRegistry(); registry.register(adapter);
    const publish = vi.spyOn(adapter, 'publishArticle'), ticks = vi.spyOn(repository, 'listDueJobs');
    const logger = createConsoleLogger();
    scheduler = new PersistentScheduler(repository, new PublisherService(repository, registry, logger), logger, 100, { allowAccountLoginSweep: () => false, allowScheduledJob: job => productPlatform(job.platformKey)?.batchPublishEnabled === true });
    let current: AccountSessionTarget = { accountId: account.id, accountName: '合成账号', platformKey: 'weibo', companyId: company.id, enabled: true, connectionMode: 'BrowserAutomation', expectedRemoteIdentity: 'synthetic-identity', loginGeneration: 1 };
    let release!: () => void, started!: () => void;
    const held = new Promise<void>(done => { release = done; }), observed = new Promise<void>(done => { started = done; });
    const transport = { manifest: { transport: 'browser' }, checkLogin: async () => { started(); await held; return 'logged_in'; }, getAccountProfile: async () => ({ accountId: 'synthetic-identity' }) } as unknown as PlatformAdapter;
    const coordinator = new AccountSessionRehydrationCoordinator({ registry: { tryGetForConnection: () => transport }, browserSessions: { restore: async () => ({}) } as unknown as BrowserSessionManager, resolveCompanyId: () => current.companyId, resolveAuthoritativeTarget: () => current });
    scheduler.start(); const pending = coordinator.refresh(current); await observed;
    await vi.advanceTimersByTimeAsync(300);
    expect(ticks.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(coordinator.getSnapshot(account.id, 'weibo')?.state).toBe('CHECKING');
    expect(repository.getAccountById(account.id)?.loginStatus).toBe('logged_in');
    current = change === 'company' ? { ...current, companyId: other.id } : change === 'generation' ? { ...current, loginGeneration: 2 } : { ...current, enabled: false };
    if (change === 'disable') repository.updateAccount(account.id, { enabled: false });
    release(); await expect(pending).resolves.toMatchObject({ state, reasonCode, identityMatched: false });
    await vi.advanceTimersByTimeAsync(400);
    expect(JSON.stringify(repository.listJobs())).toBe(frozen); expect(publish).not.toHaveBeenCalled();
    if (change === 'disable') { expect(repository.getAccountById(account.id)?.enabled).toBe(false); await expect(coordinator.refresh(current)).resolves.toMatchObject({ state: 'DISABLED' }); }
    else await expect(coordinator.refresh(current)).resolves.toMatchObject({ state: 'AUTHENTICATED', companyId: current.companyId, loginGeneration: current.loginGeneration });
  } finally { scheduler?.stop(); db.close(); vi.useRealTimers(); vi.restoreAllMocks(); }
});
