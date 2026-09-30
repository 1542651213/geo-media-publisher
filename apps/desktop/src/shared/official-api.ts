export interface OfficialApiAccountView {
  accountId: string;
  connectionMode: "OfficialAPI";
  configured: boolean;
  status: "MISSING" | "DECRYPT_FAILED" | "UNVERIFIED" | "CONNECTED" | "READ_ONLY";
  siteId: string | null;
  environment: "staging" | "production" | null;
  baseUrl: string | null;
  keyId: string | null;
  apiVersion: string | null;
  writesEnabled: boolean;
  contentTypes: Array<"article" | "case">;
  lastVerifiedAt: string | null;
}
