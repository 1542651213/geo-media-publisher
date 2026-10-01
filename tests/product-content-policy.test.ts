import { describe, expect, it } from "vitest";
import * as domain from "@publisher/domain";

describe("verified product content policy", () => {
  it("shares the accepted UTF-16 Douyin title limit with AI and publication", () => {
    const policy = (domain as unknown as { platformContentPolicy: (key: string) => { maxTitleLength: number; titleLengthMode: string } }).platformContentPolicy;
    expect(policy, "shared platform content authority exists").toBeTypeOf("function");
    expect(policy("douyin")).toMatchObject({ maxTitleLength: 20, titleLengthMode: "utf16" });
    expect(domain.conservativePlatformContentRules("douyin").titleMaxLength).toBe(20);
    expect(domain.douyinImageTextTitleError("😀".repeat(11))).not.toBeNull();
  });
});
