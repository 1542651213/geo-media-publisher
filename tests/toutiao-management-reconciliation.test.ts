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
});
