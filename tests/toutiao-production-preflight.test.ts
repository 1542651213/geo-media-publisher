import { describe, expect, it, vi } from "vitest";
import { runToutiaoProductionPreflight } from "../apps/desktop/src/main/toutiao-production-preflight";

function fixture() {
  return { readonlyMode: true, formalExecutionActive: false, account: { id: "owner", platformKey: "toutiao", externalAccountId: "creator", enabled: true },
    activate: vi.fn(async () => ({ runtimeState: "ACTIVE", sessionExists: true, contextExists: true,
      canonicalPageExists: true, contextOwnsPage: true, pageAlive: true, pageHost: "mp.toutiao.com" })),
    auth: vi.fn(async () => "VALID"), identity: vi.fn(async () => "creator"),
    smoke: vi.fn(async () => ({ scopeComplete: true, availableStatuses: ["全部", "已发布"], totalRows: 3, blockedContentMutationCount: 0 })) };
}
describe("Toutiao native production read-only preflight", () => {
  it.each([{ readonlyMode: false }, { formalExecutionActive: true }])("rejects unsafe runtime mode before touching the Context: %j", async (override) => {
    const port = { ...fixture(), ...override };
    expect((await runToutiaoProductionPreflight(port)).reasonCode).toBe("READONLY_SESSION_REQUIRED");
    expect(port.activate).not.toHaveBeenCalled(); expect(port.smoke).not.toHaveBeenCalled();
  });
  it("uses only activation/auth/identity/management capabilities", async () => {
    const port = fixture();
    expect(await runToutiaoProductionPreflight(port)).toMatchObject({ ready: true, readOnly: true,
      accountIdentityMatch: true, transport: "BrowserNative", finalSubmitCount: 0 });
    expect(port.smoke).toHaveBeenCalledOnce();
  });
  it("rejects wrong identity before management, without mutating stored authorization", async () => {
    const port = fixture(); port.identity.mockResolvedValue("another");
    expect((await runToutiaoProductionPreflight(port)).reasonCode).toBe("ACCOUNT_IDENTITY_MISMATCH");
    expect(port.smoke).not.toHaveBeenCalled();
  });
  it("stops on unowned context or incomplete management read", async () => {
    const port = fixture(); port.activate.mockResolvedValue({ ...(await port.activate()), contextOwnsPage: false });
    expect((await runToutiaoProductionPreflight(port)).ready).toBe(false);
    expect(port.auth).not.toHaveBeenCalled();
    const incomplete = fixture(); incomplete.smoke.mockResolvedValue({ scopeComplete: false, availableStatuses: [], totalRows: 0, blockedContentMutationCount: 0 });
    expect((await runToutiaoProductionPreflight(incomplete)).reasonCode).toBe("MANAGEMENT_READ_INCOMPLETE");
  });
  it("does not expose raw transport exceptions", async () => {
    const port = fixture(); port.auth.mockRejectedValue(new Error("https://x/?msToken=RAW_SECRET"));
    const result = await runToutiaoProductionPreflight(port);
    expect(JSON.stringify(result)).not.toContain("RAW_SECRET");
    expect(result.reasonCode).toBe("READONLY_PREFLIGHT_FAILED");
  });
});
