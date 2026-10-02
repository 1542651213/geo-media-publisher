import type { PublishJob } from '@publisher/domain';

export interface WorkspaceJobQuery { page?: number; pageSize?: number; platform?: string; account?: string; status?: string; date?: string; ownerOnly?: boolean }
export interface WorkspaceJobSummary { id: string; title: string; platform: string; account: string; accountId: string; date: string; status: PublishJob['status']; ownerActionRequired: boolean }
export interface WorkspaceJobPage {
  companyId: string | null; items: WorkspaceJobSummary[]; page: number; pageSize: number; pages: number; total: number;
  platforms: string[]; accounts: Array<{ id: string; label: string }>; statuses: Array<PublishJob['status']>;
}
