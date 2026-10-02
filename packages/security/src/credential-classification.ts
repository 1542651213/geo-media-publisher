import type { SafeStoragePort } from './index';

export type CredentialFailureCause = 'INVALID_METADATA' | 'TRUNCATED_OR_CORRUPTED_RECORD' | 'FORMAT_VERSION_MISMATCH'
  | 'MISSING_OS_ENCRYPTION_CONTEXT' | 'EXPECTED_UNREADABLE_UNDER_COPY_CONTEXT' | 'NATIVE_DECRYPT_FAILED_CAUSE_UNDETERMINED';
export interface CredentialDiagnostic {
  decrypt: 'PASS' | 'FAIL';
  format: 'ElectronV10' | 'ElectronV11' | 'Unrecognized';
  byteLength: number;
  failureStage: 'Metadata' | 'Format' | 'Context' | 'NativeDecrypt' | null;
  cause: CredentialFailureCause | null;
}
export interface CredentialReferenceFacts {
  auditComplete: boolean;
  currentCapabilityRequired: boolean;
  liveConsumerCount: number;
  unresolvedOperationCount: number;
  referenceExists: boolean;
  retiredRouteVerified: boolean;
}
export interface CredentialClassification {
  classification: 'READABLE' | 'ACTIVE_CREDENTIAL_RECOVERY_REQUIRED' | 'LEGACY_UNUSED_CREDENTIAL' | 'ORPHAN_REFERENCE' | 'UNKNOWN';
  lifecycle: 'ACTIVE' | 'RETIRED' | 'ORPHAN' | 'UNKNOWN';
  recovery: 'NOT_REQUIRED' | 'REQUIRED_FOR_CURRENT_RELEASE' | 'RECOVERY_NOT_REQUIRED_FOR_CURRENT_RELEASE' | 'OWNER_REVIEW_REQUIRED';
  cause: CredentialFailureCause | null;
}

/** Main-only inspection. Never returns plaintext, raw ciphertext, key names or native error text, and never writes. */
export function inspectEncryptedCredential(value: unknown, port: SafeStoragePort, context: { localStatePresent: boolean; sameWindowsUser: boolean }): CredentialDiagnostic {
  const result: CredentialDiagnostic = { decrypt: 'FAIL', format: 'Unrecognized', byteLength: 0, failureStage: 'Metadata', cause: 'INVALID_METADATA' };
  if (typeof value !== 'string') return result;
  const bytes = Buffer.from(value, 'base64');
  result.byteLength = bytes.length;
  result.failureStage = 'Format';
  result.cause = 'TRUNCATED_OR_CORRUPTED_RECORD';
  if (!value || bytes.toString('base64') !== value) return result;
  const prefix = bytes.subarray(0, 3).toString('ascii');
  result.format = prefix === 'v10' ? 'ElectronV10' : prefix === 'v11' ? 'ElectronV11' : 'Unrecognized';
  // Windows OSCrypt envelope: three-byte version, nonce and authentication tag.
  if (result.format !== 'Unrecognized' && bytes.length < 31) return result;
  result.cause = 'FORMAT_VERSION_MISMATCH';
  if (result.format === 'Unrecognized') return result;
  result.failureStage = 'Context';
  if (!context.sameWindowsUser) { result.cause = 'EXPECTED_UNREADABLE_UNDER_COPY_CONTEXT'; return result; }
  if (!context.localStatePresent || !port.isEncryptionAvailable()) { result.cause = 'MISSING_OS_ENCRYPTION_CONTEXT'; return result; }
  result.failureStage = 'NativeDecrypt';
  result.cause = 'NATIVE_DECRYPT_FAILED_CAUSE_UNDETERMINED';
  try {
    // The temporary native string is intentionally discarded in this scope.
    if (typeof port.decryptString(bytes) === 'string') { result.decrypt = 'PASS'; result.failureStage = null; result.cause = null; }
  } catch { /* Native exceptions can contain sensitive material; expose only the fixed cause. */ }
  return result;
}

/** Release impact and cryptographic cause are independent: old unreadable bytes alone never prove obsolescence. */
export function classifyCredential(diagnostic: CredentialDiagnostic, facts: CredentialReferenceFacts): CredentialClassification {
  const unknown: CredentialClassification = { classification: 'UNKNOWN', lifecycle: 'UNKNOWN', recovery: 'OWNER_REVIEW_REQUIRED', cause: diagnostic.cause };
  if (!facts.auditComplete || !Number.isSafeInteger(facts.liveConsumerCount) || facts.liveConsumerCount < 0
    || !Number.isSafeInteger(facts.unresolvedOperationCount) || facts.unresolvedOperationCount < 0) return unknown;
  if (diagnostic.decrypt === 'PASS') return { ...unknown, classification: 'READABLE', lifecycle: facts.referenceExists ? 'ACTIVE' : 'ORPHAN', recovery: 'NOT_REQUIRED' };
  if (facts.currentCapabilityRequired) return { ...unknown, classification: 'ACTIVE_CREDENTIAL_RECOVERY_REQUIRED', lifecycle: 'ACTIVE', recovery: 'REQUIRED_FOR_CURRENT_RELEASE' };
  if (facts.liveConsumerCount || facts.unresolvedOperationCount) return unknown;
  if (!facts.referenceExists) return { ...unknown, classification: 'ORPHAN_REFERENCE', lifecycle: 'ORPHAN', recovery: 'RECOVERY_NOT_REQUIRED_FOR_CURRENT_RELEASE' };
  if (facts.retiredRouteVerified) return { ...unknown, classification: 'LEGACY_UNUSED_CREDENTIAL', lifecycle: 'RETIRED', recovery: 'RECOVERY_NOT_REQUIRED_FOR_CURRENT_RELEASE' };
  return unknown;
}
