import { describe, expect, it } from "vitest";
import { matchToutiaoManagementRows, type ToutiaoManagementRow } from "../packages/adapters/toutiao/src/management-reconciliation";

const submittedAt = "2026-09-25T00:30:00.000Z";
const title = "GMP 唯一测试 0925";
const row = (status: string, id = "7777777777777777777"): ToutiaoManagementRow => ({
  title, rowText: `${title} 2026-09-25 08:31 ${status}`,
  href: `https://www.toutiao.com/article/${id}/`, dataId: id
});
const target = { title, submittedAt, accountIdentityVerified: true, remoteId: null };

describe("Toutiao account-owned management list reconciliation", () => {
  it.each([
    ["草稿", "DRAFT"], ["审核中", "REVIEWING"], ["定时待发布", "SCHEDULED"],
    ["已发布", "PUBLISHED"], ["已拒绝", "REJECTED"]
  ] as const)("classifies only the matched target row: %s", (label, expected) => {
    const result = matchToutiaoManagementRows([row(label), { ...row("已发布", "8888888888888888888"),
      title: "其他文章", rowText: "其他文章 2026-09-25 08:31 已发布" }], target);
    expect(result.state).toBe(expected);
  });

  it("never treats a different row's published state as the target state", () => {
    const result = matchToutiaoManagementRows([{ ...row("审核中"), rowText: `${title} 2026-09-25 08:31 审核中` },
      { ...row("已发布", "8888888888888888888"), title: "其他文章", rowText: "其他文章 已发布" }], target);
    expect(result.state).toBe("REVIEWING");
  });

  it("uses remote id first and rejects ambiguous or unverifiable matches", () => {
    expect(matchToutiaoManagementRows([row("已发布"), row("已发布", "8888888888888888888")], target).state).toBe("AMBIGUOUS");
    expect(matchToutiaoManagementRows([row("已发布"), row("已发布", "8888888888888888888")],
      { ...target, remoteId: "7777777777777777777" }).state).toBe("PUBLISHED");
    expect(matchToutiaoManagementRows([row("已发布")], { ...target, accountIdentityVerified: false }).state).toBe("UNKNOWN");
    expect(matchToutiaoManagementRows([], target).state).toBe("NOT_FOUND");
    expect(matchToutiaoManagementRows([row("已发布")], { ...target, submittedAt: "2026-09-24T00:30:00.000Z" }).state).toBe("NOT_FOUND");
  });

  it("prefers a trusted remote id over same-title candidates and title normalization", () => {
    expect(matchToutiaoManagementRows([
      { ...row("已发布"), title: "平台显示的规范标题" }, row("审核中", "8888888888888888888")
    ], { ...target, remoteId: "7777777777777777777" })).toMatchObject({ state: "PUBLISHED", matchedRowCount: 1 });
  });

  it("deduplicates the same remote row across status pages but retains conflicting state as unknown", () => {
    expect(matchToutiaoManagementRows([row("已发布"), row("已发布")], target).state).toBe("PUBLISHED");
    expect(matchToutiaoManagementRows([row("已发布"), row("审核中")], target).state).toBe("UNKNOWN");
    expect(matchToutiaoManagementRows([row("未通过")], target).state).toBe("REJECTED");
  });

  it("retains only an explicit sanitized reason from the uniquely rejected target row", () => {
    const rejected = { ...row("未通过"), rowText: `${title} 2026-09-25 08:31 未通过 原因：标题与正文不一致` };
    expect(matchToutiaoManagementRows([rejected, { ...row("未通过", "888"), title: "另一篇",
      rowText: "另一篇 未通过 原因：不同原因" }], target).sanitizedRejectReason).toBe("标题与正文不一致");
    expect(matchToutiaoManagementRows([row("未通过")], target).sanitizedRejectReason).toBeNull();
    expect(matchToutiaoManagementRows([{ ...rejected, rowText: `${rejected.rowText} token=PRIVATE` }], target)
      .sanitizedRejectReason).toBeNull();
    for (const reason of ["cookie: PRIVATE", "联系 13800138000", "联系 １３８００１３８０００", "signature: PRIVATE", "微信：privateuser"]) {
      const result = matchToutiaoManagementRows([{ ...rejected, rowText: `${title} 2026-09-25 08:31 未通过 原因：${reason}` }], target);
      expect(result.sanitizedRejectReason).toBeNull();
      expect(JSON.stringify(result)).not.toContain(reason);
    }
    expect(matchToutiaoManagementRows([{ ...rejected, rowText: `${title} 2026-09-25 08:31 已发布 原因：标题与正文不一致` }], target)
      .sanitizedRejectReason).toBeNull();
    expect(matchToutiaoManagementRows([rejected, { ...rejected, href: "/article/888", dataId: "888" }], target)
      .sanitizedRejectReason).toBeNull();
  });
});
