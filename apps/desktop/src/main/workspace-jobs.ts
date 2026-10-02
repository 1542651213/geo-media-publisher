import type { AppRepository } from '@publisher/db';
import type { CompanyWorkspace } from './company-workspace';
import { z } from 'zod';
import type { WorkspaceJobPage, WorkspaceJobSummary } from '../shared/workspace-jobs';

export function listWorkspaceJobs(repository: AppRepository, workspace: Pick<CompanyWorkspace, 'current'>, filters: { status?: string } = {}): ReturnType<AppRepository['listJobs']> {
  const companyId = workspace.current();
  return companyId ? repository.listJobs({ ...filters, brandId: companyId }) : [];
}

const querySchema = z.strictObject({ page: z.number().int().min(1).max(1000000).optional().default(1), pageSize: z.number().int().min(1).optional().default(50),
  platform: z.string().max(100).optional(), account: z.string().max(200).optional(), status: z.string().max(100).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional(), ownerOnly: z.boolean().optional() });

/** Main captures company authority once. This bounded read model never changes Scheduler or frozen Job data. */
export function pageWorkspaceJobs(repository: AppRepository, workspace: Pick<CompanyWorkspace, 'current'>, payload: unknown = {}): WorkspaceJobPage {
  const input = querySchema.parse(payload), companyId = workspace.current(), pageSize = Math.min(100, input.pageSize);
  const empty: WorkspaceJobPage = { companyId, items: [], page: 1, pageSize, total: 0, pages: 1, platforms: [], accounts: [], statuses: [] };
  if (!companyId) return empty;
  const base = ' FROM publish_jobs j JOIN articles a ON a.id=j.article_id', where = ['a.brand_id=?'], values: Array<string | number> = [companyId];
  if (input.platform) { where.push('j.platform_key=?'); values.push(input.platform); }
  if (input.account) { where.push('j.account_id=?'); values.push(input.account); }
  if (input.status) { where.push('j.status=?'); values.push(input.status); }
  if (input.date) { where.push('substr(COALESCE(j.finished_at,j.started_at,j.created_at),1,10)=?'); values.push(input.date); }
  if (input.ownerOnly) where.push("j.status IN ('NeedsUserAction','NeedsReconciliation','Unknown')");
  const filter = ' WHERE ' + where.join(' AND ');
  const total = (repository.db.prepare('SELECT COUNT(*) n' + base + filter).get(...values) as { n: number }).n, pages = Math.max(1, Math.ceil(total / pageSize)), page = Math.min(input.page, pages);
  const label = "CASE WHEN b.company_id=a.brand_id THEN COALESCE(NULLIF(c.account_alias,''),NULLIF(c.platform_account_name,''),c.name) ELSE '历史账号' END";
  const accountJoin = ' LEFT JOIN accounts c ON c.id=j.account_id LEFT JOIN operations_account_company_bindings b ON b.account_id=c.id';
  const items = repository.db.prepare(`SELECT j.id,a.title,j.platform_key platform,j.account_id accountId,${label} account,
    COALESCE(j.finished_at,j.started_at,j.created_at) date,j.status` + base + accountJoin + filter + ' ORDER BY j.scheduled_at DESC,j.id DESC LIMIT ? OFFSET ?')
    .all(...values, pageSize, (page - 1) * pageSize) as Omit<WorkspaceJobSummary, 'ownerActionRequired'>[];
  const facets = repository.db.prepare(`SELECT DISTINCT j.platform_key platform,j.status,j.account_id accountId,${label} account` + base + accountJoin + ' WHERE a.brand_id=?').all(companyId) as Array<{ platform: string; status: WorkspaceJobSummary['status']; accountId: string; account: string }>;
  return { companyId, total, pages, page, pageSize, items: items.map(item => ({ ...item, ownerActionRequired: ['NeedsUserAction', 'NeedsReconciliation', 'Unknown'].includes(item.status) })),
    platforms: [...new Set(facets.map(item => item.platform))].sort(), statuses: [...new Set(facets.map(item => item.status))].sort(),
    accounts: [...new Map(facets.map(item => [item.accountId, { id: item.accountId, label: item.account }])).values()] };
}
