export interface AISentDataPreview { provider:string;endpoint:string;companyName:string;sourceText:string;contextText:string;templateText:string;sourcePolicy:string }
export interface AIWorkloadEstimate {
  kind:'Studio'|'Queue'; companyId:string; sourceCount:number; targetCount:number; workItemCount:number;
  baseRequests:number; maxRequests:number; titleRepairAllowance:number; rateLimitRetryAllowance:number;
  globalConcurrency:1; maxOutputTokensPerRequest:number; inputCharacters:number; model:string;
  templateId:string; templateVersion:number; costEstimate:null; currency:null;
  dataSent?:AISentDataPreview;
}
export interface AIWorkloadPreview extends AIWorkloadEstimate { previewId:string; createdAt:string }
export interface AIRequestBudget extends AIWorkloadPreview { issuedRequests:number; status:string; requestFingerprint:string; snapshotFingerprint:string }
