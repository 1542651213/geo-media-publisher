import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type FrozenWeiboBaseline = {
  platformKey: "weibo";
  browserMode: "VISIBLE";
  contentModel: "ordinary_post";
  bodyFilled: boolean;
  imageUploaded: boolean;
  clickCount: number;
  finalSubmitCount: number;
  externalId: string;
  externalUrl: string;
  bodyMatch: boolean;
  urlReachable: boolean;
  job: { count: number; id: string; status: "Success" };
  publishRecord: { count: number; id: string; status: "Published"; success: boolean; verificationStatus: "Verified" };
  submissionIntent: { count: number; id: string; state: "Submitted"; finalSubmitCount: number };
  sourceEvidence: string;
};

const baselinePath = join(process.cwd(), "scripts", "v127-weibo-real-publish-baseline.json");

describe("V1.2.0 frozen Weibo real-publish chain", () => {
  it("keeps the verified ordinary-post one-submit contract", () => {
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as FrozenWeiboBaseline;

    expect(baseline).toMatchObject({
      platformKey: "weibo",
      browserMode: "VISIBLE",
      contentModel: "ordinary_post",
      bodyFilled: true,
      imageUploaded: true,
      clickCount: 1,
      finalSubmitCount: 1,
      bodyMatch: true,
      urlReachable: true,
      job: { count: 1, id: "d9582333-7b4f-4957-a3a3-ad5abf1c0300", status: "Success" },
      publishRecord: { count: 1, id: "4a46a856-0beb-4d13-9855-09e41201ef39", status: "Published", success: true, verificationStatus: "Verified" },
      submissionIntent: { count: 1, id: "e090aaf4-e53c-49bd-9000-300524159bb3", state: "Submitted", finalSubmitCount: 1 }
    });
    expect(baseline.externalId).toBe("Rf17LuR6n");
    expect(baseline.externalUrl).toBe("https://weibo.com/4020073566/Rf17LuR6n");
    expect(baseline.sourceEvidence).toBe("output/v125-weibo-correct-external-evidence.json");
  });
});
