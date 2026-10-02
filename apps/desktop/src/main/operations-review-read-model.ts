import type { AppRepository } from '@publisher/db';
import type { OperationsReviewItem } from '../shared/content-operations';

interface ReviewRow { id: string; title: string; source: string; ai_provider: string; target_platforms_json: string; status: OperationsReviewItem['articleStatus']; content_hash: string; quality_warnings_json: string; created_at: string; updated_at: string; review_status: OperationsReviewItem['reviewStatus'] }
function strings(value: string): string[] { try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []; } catch { return []; } }

/** One metadata join replaces per-article state, review-journal and full-body reads. */
export function readOperationsReviewItems(repository: AppRepository, companyId: string): OperationsReviewItem[] {
  const rows = repository.db.prepare(`SELECT a.id,a.title,a.source,a.ai_provider,a.target_platforms_json,a.status,a.content_hash,a.quality_warnings_json,a.created_at,
    COALESCE(q.updated_at,a.updated_at,a.created_at) updated_at,
    CASE WHEN q.content_hash=a.content_hash THEN q.status ELSE 'Draft' END review_status
    FROM articles a LEFT JOIN content_quality_states q ON q.content_type='article' AND q.content_id=a.id AND q.brand_id=a.brand_id
    WHERE a.brand_id=? ORDER BY COALESCE(q.updated_at,a.updated_at,a.created_at) DESC,a.id DESC`).all(companyId) as ReviewRow[];
  return rows.map(row => ({ articleId: row.id, companyId, title: row.title, source: row.source ?? 'production', aiGenerated: row.source === 'content_studio' || !['manual', 'excel_import'].includes(row.ai_provider),
    targetPlatforms: strings(row.target_platforms_json), articleStatus: row.status, reviewStatus: row.review_status, contentHash: row.content_hash,
    validationWarnings: strings(row.quality_warnings_json), createdAt: row.created_at, updatedAt: row.updated_at }));
}
