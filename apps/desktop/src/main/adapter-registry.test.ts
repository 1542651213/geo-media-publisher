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
});
