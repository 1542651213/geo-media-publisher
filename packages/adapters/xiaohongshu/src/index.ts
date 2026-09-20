import type { ErrorCode } from "@publisher/domain";
import { mapManualError } from "@publisher/adapters-manual";
import { XiaohongshuBrowserAdapter } from "./browser";

export * from "./browser";
export * from "./auth-state-diagnostics";
export * from "./navigation-diagnostics";
export * from "./image-editor-discovery";
export * from "./editor-load-diagnostic";
export * from "./editor-network-diagnostic";
export * from "./context-page-inventory";
export * from "./publish-editor-dom-diagnostic";
export * from "./publish-editor-semantic-diagnostic";
export * from "./global-exact-publish-diagnostic";
export * from "./task10s-final-surface";
export * from "./task10s-closed-shadow-final-submit";
export * from "./task10s-retained-editor-completion";
export * from "./post-upload-reconciliation-diagnostic";
export * from "./post-upload-terminal-readiness";
export * from "./file-input-diagnostic";
export * from "./upload-delivery-diagnostic";
export * from "./native-file-picker-recovery";
export * from "./picker-cancel-stabilization";
export * from "./publish-flow-exploration";
export * from "./identity";
export * from "./manager-list-reconciliation";

export function mapXiaohongshuError(message: string, httpStatus?: number): ErrorCode { return mapManualError(message, httpStatus); }

/** Compatibility name retained for registry and existing callers. */
export class XiaohongshuAdapter extends XiaohongshuBrowserAdapter {}
export const XiaohongshuOfficialAdapter = XiaohongshuAdapter;
export default XiaohongshuAdapter;
