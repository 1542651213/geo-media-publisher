import { describe, expect, it } from 'vitest';
import type { SafeStoragePort } from '@publisher/security';
import { classifyCredential, inspectEncryptedCredential, type CredentialReferenceFacts } from '../packages/security/src/credential-classification';

const valid = Buffer.concat([Buffer.from('v10'), Buffer.alloc(40, 7)]).toString('base64');
const port: SafeStoragePort = { isEncryptionAvailable: () => true, encryptString: () => Buffer.alloc(0), decryptString: () => 'PRIVATE_FIXTURE_PLAINTEXT_MUST_NOT_ESCAPE' };
const broken: SafeStoragePort = { ...port, decryptString: () => { throw new Error('PRIVATE_NATIVE_ERROR_AND_KEY_MUST_NOT_ESCAPE'); } };
const context = { localStatePresent: true, sameWindowsUser: true };
const active: CredentialReferenceFacts = { auditComplete: true, currentCapabilityRequired: true, liveConsumerCount: 1, unresolvedOperationCount: 0, referenceExists: true, retiredRouteVerified: false };
const retired: CredentialReferenceFacts = { auditComplete: true, currentCapabilityRequired: false, liveConsumerCount: 0, unresolvedOperationCount: 0, referenceExists: true, retiredRouteVerified: true };

describe('read-only credential compatibility and release impact', () => {
  it('returns only metadata for a valid current SafeStorage record', () => {
    const diagnostic = inspectEncryptedCredential(valid, port, context);
    expect(diagnostic).toMatchObject({ decrypt: 'PASS', format: 'ElectronV10', failureStage: null });
    expect(classifyCredential(diagnostic, active)).toMatchObject({ lifecycle: 'ACTIVE', classification: 'READABLE', recovery: 'NOT_REQUIRED' });
    expect(JSON.stringify(diagnostic)).not.toContain('PRIVATE_');
  });
  it('keeps a required unreadable credential active and blocks readiness without exposing native errors', () => {
    const diagnostic = inspectEncryptedCredential(valid, broken, context);
    expect(classifyCredential(diagnostic, active)).toMatchObject({ lifecycle: 'ACTIVE', classification: 'ACTIVE_CREDENTIAL_RECOVERY_REQUIRED', recovery: 'REQUIRED_FOR_CURRENT_RELEASE' });
    expect(JSON.stringify(diagnostic)).not.toContain('PRIVATE_');
  });
  it('classifies a proven retired route while preserving an unknown native decryption cause', () => {
    const diagnostic = inspectEncryptedCredential(valid, broken, context);
    expect(diagnostic.cause).toBe('NATIVE_DECRYPT_FAILED_CAUSE_UNDETERMINED');
    expect(classifyCredential(diagnostic, retired)).toMatchObject({ lifecycle: 'RETIRED', classification: 'LEGACY_UNUSED_CREDENTIAL', recovery: 'RECOVERY_NOT_REQUIRED_FOR_CURRENT_RELEASE' });
    expect(classifyCredential(diagnostic, { ...retired, unresolvedOperationCount: 1 }).classification).toBe('UNKNOWN');
    expect(classifyCredential(diagnostic, { ...retired, liveConsumerCount: 1 }).classification).toBe('UNKNOWN');
    expect(classifyCredential(diagnostic, { ...retired, auditComplete: false }).classification).toBe('UNKNOWN');
  });
  it('distinguishes missing Local State from deliberately different Windows-user copy context', () => {
    expect(inspectEncryptedCredential(valid, broken, { ...context, localStatePresent: false }).cause).toBe('MISSING_OS_ENCRYPTION_CONTEXT');
    expect(inspectEncryptedCredential(valid, broken, { ...context, sameWindowsUser: false }).cause).toBe('EXPECTED_UNREADABLE_UNDER_COPY_CONTEXT');
  });
  it.each([
    [null, 'INVALID_METADATA'],
    ['not canonical base64!', 'TRUNCATED_OR_CORRUPTED_RECORD'],
    [Buffer.from('v10short').toString('base64'), 'TRUNCATED_OR_CORRUPTED_RECORD'],
    [Buffer.from('legacy:' + 'x'.repeat(40)).toString('base64'), 'FORMAT_VERSION_MISMATCH']
  ])('reports malformed or unsupported input without claiming it was decrypted: %j', (value, cause) => {
    expect(inspectEncryptedCredential(value, broken, context)).toMatchObject({ decrypt: 'FAIL', cause });
  });
  it('requires complete reference evidence before classifying an orphan', () => {
    const diagnostic = inspectEncryptedCredential(valid, broken, context);
    expect(classifyCredential(diagnostic, { ...retired, retiredRouteVerified: false, referenceExists: false })).toMatchObject({ lifecycle: 'ORPHAN', classification: 'ORPHAN_REFERENCE' });
    expect(classifyCredential(diagnostic, { ...retired, retiredRouteVerified: false })).toMatchObject({ lifecycle: 'UNKNOWN', classification: 'UNKNOWN' });
  });
});
