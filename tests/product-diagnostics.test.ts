import { expect, it } from "vitest";
import * as policy from "../apps/desktop/src/shared/product-platform-policy";
it("exports only allowlisted metadata, excluding company content and credentials", () => {
  const build = (policy as unknown as { buildProductDiagnosticBundle(input: unknown): unknown }).buildProductDiagnosticBundle;
  expect(build, "allowlisted diagnostic builder exists").toBeTypeOf("function");
  const bundle = build({ version: "1.1.9", migrationCount: 39, providers: [{ provider: "mimo", configured: true, verificationStatus: "Verified", baseUrl: "https://secret.example/private", credentialRef: "secret-reference", apiKey: "fixture-only-secret" }], generationStatuses: ["Generated"], content: "private-company-source", prompt: "private-prompt", account: "private-account", jobs: 45 });
  const text = JSON.stringify(bundle);
  expect(text).not.toMatch(/fixture-only-secret|private-company-source|private-prompt|private-account|secret-reference|secret.example/u);
  expect(text).toContain('"configured":true');
});
