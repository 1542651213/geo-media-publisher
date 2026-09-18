import { join } from "node:path";
import type { Account, ImageAsset } from "@publisher/domain";

export const XIAOHONGSHU_GATE_ORDER = [
  "Account Identity",
  "Login / Session",
  "Image-post Entry",
  "Image Upload",
  "Title Editor",
  "Title Write",
  "Title Readback",
  "Body Editor",
  "Body Write",
  "Body Readback",
  "Required Fields",
  "Publish Settings",
  "Final Submit Control discovery"
] as const;

export const XIAOHONGSHU_TEST_BODY = "这是 Geo Media Publisher 小红书 BrowserAutomation 图文能力验证内容，仅用于验证账号、图片、标题、正文和发布控件，不执行最终发布。";
export const XIAOHONGSHU_OUTPUT_PATH = join(process.cwd(), "output", "v142-xiaohongshu-gate-only.json");
/** A live diagnostic must receive the owner-controlled path at runtime. */
export const XIAOHONGSHU_USER_DATA_PATH = process.env.GEO_PUBLISHER_USER_DATA_PATH ?? "";

export type GateResult = "PASS" | "KNOWN" | "VERIFIED" | "FAIL" | "NOT_RUN";
export interface GateState { result: GateResult; evidence?: unknown; }
export type GateStateMap = Record<string, GateState>;

export function buildXiaohongshuTestTitle(date: Date = new Date(), timeZone = "Asia/Shanghai"): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `GMP 小红书图文能力验证 ${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export function selectXiaohongshuSelfTestImage(images: ImageAsset[]): ImageAsset | null {
  return images.find((image) => image.filePath.trim().length > 0 && (image.universal || [...image.usage, ...image.tags].some((label) => /^(?:SELF_TEST|测试|通用)$/iu.test(label.trim())))) ?? null;
}

export function resolveExplicitXiaohongshuAccount(accounts: Account[], accountId: string | null | undefined): Account {
  const requested = accountId?.trim() ?? "";
  if (!requested) throw new Error("XIAOHONGSHU_ACCOUNT_ID is required; account fallback is forbidden");
  const account = accounts.find((candidate) => candidate.id === requested && candidate.platformKey === "xiaohongshu");
  if (!account) throw new Error(`XIAOHONGSHU account not found: ${requested}`);
  return account;
}

export function resolveXiaohongshuAccountId(cliAccountId: string | null | undefined, environmentAccountId: string | null | undefined): string {
  const requested = cliAccountId?.trim() || environmentAccountId?.trim() || "";
  if (!requested) throw new Error("XIAOHONGSHU_ACCOUNT_ID is required; account fallback is forbidden");
  return requested;
}

export function classifyXiaohongshuLoginFailure(loginStatus: string, storedSessionPresent: boolean): "LOGIN_REQUIRED" | "SECURITY_VERIFICATION_REQUIRED" {
  return loginStatus === "needs_user_action" && storedSessionPresent ? "SECURITY_VERIFICATION_REQUIRED" : "LOGIN_REQUIRED";
}

export function isXiaohongshuReady(gates: GateStateMap, finalSubmitCount: number, securityVerification: string): boolean {
  const expected: Record<string, GateResult> = {
    "Account Identity": "PASS",
    "Login / Session": "PASS",
    "Image-post Entry": "PASS",
    "Image Upload": "PASS",
    "Title Editor": "PASS",
    "Title Write": "PASS",
    "Title Readback": "PASS",
    "Body Editor": "PASS",
    "Body Write": "PASS",
    "Body Readback": "PASS",
    "Required Fields": "KNOWN",
    "Publish Settings": "KNOWN",
    "Final Submit Control discovery": "VERIFIED"
  };
  return securityVerification === "NONE" && finalSubmitCount === 0 && Object.entries(expected).every(([gate, result]) => gates[gate]?.result === result);
}
