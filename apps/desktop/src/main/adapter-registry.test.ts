import { describe, expect, it } from "vitest";
import { createRuntimeAdapterRegistry } from "./adapter-registry";
import type { CredentialStore } from "@publisher/security";

const credentials: CredentialStore = {
  get: () => null,
  set: () => undefined,
  delete: () => undefined,
  has: () => false
};

describe("runtime adapter registry", () => {
  it("discovers Kangyi as an Official API website adapter", () => {
    const registry = createRuntimeAdapterRegistry(credentials, false);
    const adapter = registry.get("kangyi_website");
    expect(adapter.manifest).toMatchObject({ integrationMode: "API", transport: "official_api", supportsArticle: true, supportsVideo: false });
    expect(registry.getAccountConnectionMode("kangyi_website")).toBe("API");
  });

  it("registers Huiquan and Shupai as isolated Official API website accounts", () => {
    const registry = createRuntimeAdapterRegistry(credentials, false);
    for (const siteId of ["huiquan", "shupai"] as const) {
      const adapter = registry.get(`${siteId}_website`);
      expect(adapter.manifest.platformKey).toBe(`${siteId}_website`);
      expect(adapter.manifest.transport).toBe("official_api");
      expect(registry.getAccountConnectionMode(`${siteId}_website`)).toBe("API");
    }
  });
});
