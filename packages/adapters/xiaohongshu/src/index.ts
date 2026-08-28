import type { ErrorCode } from "@publisher/domain";
import { mapManualError } from "@publisher/adapters-manual";
import { XiaohongshuBrowserAdapter } from "./browser";

export * from "./browser";
export * from "./auth-state-diagnostics";

export function mapXiaohongshuError(message: string, httpStatus?: number): ErrorCode { return mapManualError(message, httpStatus); }

/** Compatibility name retained for registry and existing callers. */
export class XiaohongshuAdapter extends XiaohongshuBrowserAdapter {}
export const XiaohongshuOfficialAdapter = XiaohongshuAdapter;
export default XiaohongshuAdapter;
