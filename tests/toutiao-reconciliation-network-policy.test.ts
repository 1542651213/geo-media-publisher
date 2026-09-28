import { describe, expect, it } from "vitest";
import { classifyReconciliationRequest } from "../packages/adapters/toutiao/src/reconciliation-network-policy";

const proven = [{ host: "mp.toutiao.com", path: "/mp/agw/creator_center/item/list",
  allowedBodyKeys: ["page", "page_size", "status"], allowedQueryKeys: ["source"] }] as const;
const check = (method: string, path: string, bodyKeys: string[] = []) =>
  classifyReconciliationRequest({ method, url: `https://mp.toutiao.com${path}`, bodyKeys }, proven);

describe("Toutiao reconciliation network policy", () => {
  it("allows GET and OPTIONS and an exact proven read-only POST shape", () => {
    expect(check("GET", "/mp/agw/creator_center/item/list")).toBe("ALLOW_READ");
    expect(check("OPTIONS", "/mp/agw/creator_center/item/list")).toBe("ALLOW_READ");
    expect(check("POST", "/mp/agw/creator_center/item/list?source=manage", ["page", "status"]))
      .toBe("ALLOW_READ");
    expect(check("GET", "/profile_v4/manage/draft")).toBe("ALLOW_READ");
    expect(check("POST", "/profile_v4/manage/draft")).toBe("BLOCK_CONTENT_MUTATION");
    expect(check("GET", "/api/feed/mp_provider/v1/?page=1")).toBe("ALLOW_READ");
    expect(check("GET", "/mp/agw/creator_center/draft_list?count=10")).toBe("ALLOW_READ");
    expect(check("GET", "/api/unknown/write-like")).toBe("BLOCK_UNKNOWN");
    expect(classifyReconciliationRequest({ method: "GET",
      url: "https://lf-content-ecology.toutiaostatic.com/obj/safe.js" })).toBe("ALLOW_READ");
    expect(classifyReconciliationRequest({ method: "GET",
      url: "https://evil.example/obj/safe.js" })).toBe("BLOCK_UNKNOWN");
  });

  it("blocks telemetry by default and all unknown or deceptive POSTs", () => {
    expect(classifyReconciliationRequest({ method: "POST", url: "https://mp.toutiao.com/monitor_browser/collect/batch/" }))
      .toBe("BLOCK_TELEMETRY");
    expect(classifyReconciliationRequest({ method: "POST", url: "https://mcs.zijieapi.com/list" }))
      .toBe("BLOCK_UNKNOWN");
    expect(check("POST", "/bcs/notice/boxes/")).toBe("BLOCK_UNKNOWN");
    expect(check("POST", "/mp/agw/creator_center/item/list-extra", ["page"]))
      .toBe("BLOCK_UNKNOWN");
    expect(classifyReconciliationRequest({ method: "POST",
      url: "https://evil.example/mp/agw/creator_center/item/list", bodyKeys: ["page"] }, proven))
      .toBe("BLOCK_UNKNOWN");
    expect(check("POST", "/mp/agw/creator_center/item/list", ["page", "save"]))
      .toBe("BLOCK_UNKNOWN");
    expect(check("POST", "/mp/agw/creator_center/item/list?delete=1", ["page"]))
      .toBe("BLOCK_UNKNOWN");
  });

  it.each(["/mp/agw/article/publish", "/mp/agw/article/new", "/mp/agw/draft/save",
    "/mp/agw/media/upload", "/mp/agw/image/upload", "/mp/agw/article/delete",
    "/mp/agw/article/update"])("hard-blocks content mutation %s", (path) => {
    expect(check("POST", path)).toBe("BLOCK_CONTENT_MUTATION");
    expect(check("GET", path)).toBe("BLOCK_CONTENT_MUTATION");
  });
});
