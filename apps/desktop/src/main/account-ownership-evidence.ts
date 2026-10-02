import type { AppRepository } from '@publisher/db';
import type { AccountOnboardingEvidence, AccountOnboardingSource, OwnershipSourceKind } from '../shared/account-onboarding';

interface EvidenceRow { account_id: string; company_id: string; article_id: string; job_id: string; reference_id: string; kind: OwnershipSourceKind }
interface Accumulator { jobs: Set<string>; records: Set<string>; images: Set<string>; operations: Set<string>; articles: Set<string>; sources: AccountOnboardingSource[] }

/** Relational metadata only. No article text, media paths, credential fields or remote response bodies. */
export function collectAccountOwnershipEvidence(repository: AppRepository): Map<string, AccountOnboardingEvidence[]> {
  const companies = new Map(repository.listBrands().map(company => [company.id, company]));
  const rows = repository.db.prepare(`
    SELECT j.account_id,a.brand_id company_id,a.id article_id,j.id job_id,j.id reference_id,'HistoricalJob' kind
      FROM publish_jobs j JOIN articles a ON a.id=j.article_id WHERE a.brand_id IS NOT NULL
    UNION ALL SELECT r.account_id,a.brand_id,a.id,r.job_id,r.id,'PublishRecord'
      FROM publish_records r JOIN articles a ON a.id=r.article_id WHERE a.brand_id IS NOT NULL
    UNION ALL SELECT j.account_id,m.brand_id,j.article_id,j.id,m.id,'SelectedImage'
      FROM publish_jobs j JOIN media_assets m ON m.id=j.selected_image_asset_id WHERE m.brand_id IS NOT NULL
      AND CASE WHEN json_valid(m.metadata_json) THEN COALESCE(json_extract(m.metadata_json,'$.universal'),0)=0 ELSE 0 END
    UNION ALL SELECT r.account_id,m.brand_id,r.article_id,r.job_id,m.id,'SelectedImage'
      FROM publish_records r JOIN media_assets m ON m.id=r.selected_image_asset_id WHERE m.brand_id IS NOT NULL
      AND CASE WHEN json_valid(m.metadata_json) THEN COALESCE(json_extract(m.metadata_json,'$.universal'),0)=0 ELSE 0 END
    UNION ALL SELECT o.account_id,a.brand_id,a.id,o.job_id,o.job_id,'OfficialApiOperation'
      FROM official_api_operations o JOIN articles a ON a.id=o.source_article_id WHERE a.brand_id IS NOT NULL
    ORDER BY account_id,company_id,kind,reference_id`).all() as EvidenceRow[];
  const grouped = new Map<string, Map<string, Accumulator>>();
  for (const row of rows) {
    if (!companies.has(row.company_id)) continue;
    let account = grouped.get(row.account_id); if (!account) { account = new Map(); grouped.set(row.account_id, account); }
    let evidence = account.get(row.company_id);
    if (!evidence) { evidence = { jobs: new Set(), records: new Set(), images: new Set(), operations: new Set(), articles: new Set(), sources: [] }; account.set(row.company_id, evidence); }
    const references = row.kind === 'HistoricalJob' ? evidence.jobs : row.kind === 'PublishRecord' ? evidence.records : row.kind === 'SelectedImage' ? evidence.images : evidence.operations;
    references.add(row.reference_id); evidence.articles.add(row.article_id);
    if (evidence.sources.filter(source => source.kind === row.kind).length < 3)
      evidence.sources.push({ kind: row.kind, referenceId: row.reference_id, jobId: row.job_id, articleId: row.article_id, brandId: row.company_id });
  }
  return new Map([...grouped].map(([accountId, companiesForAccount]) => [accountId, [...companiesForAccount].map(([companyId, evidence]) => {
    const company = companies.get(companyId)!;
    return { companyId, companyName: company.companyName || company.name, source: evidence.jobs.size ? 'HistoricalJobArticleBrand' as const : 'RelationalMetadata' as const,
      jobCount: evidence.jobs.size, recordCount: evidence.records.size, imageCount: evidence.images.size, officialOperationCount: evidence.operations.size,
      articleCount: evidence.articles.size, brandCount: 1, sources: evidence.sources };
  })]));
}
