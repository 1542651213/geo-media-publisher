import type { AppRepository } from '@publisher/db';
import type { CompanyWorkspace } from './company-workspace';

export function listWorkspaceJobs(repository: AppRepository, workspace: Pick<CompanyWorkspace, 'current'>, filters: { status?: string } = {}): ReturnType<AppRepository['listJobs']> {
  const companyId = workspace.current();
  return companyId ? repository.listJobs({ ...filters, brandId: companyId }) : [];
}
