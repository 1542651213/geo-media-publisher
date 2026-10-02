import { expect, it } from 'vitest';
import type { CredentialStore } from '@publisher/security';
import { createRuntimeAdapterRegistry } from '../apps/desktop/src/main/adapter-registry';
import { operatorPublishBlockReason, productPlatform, PRODUCT_PLATFORM_POLICY } from '../apps/desktop/src/shared/product-platform-policy';
import { officialApiCredentialRef, readOfficialApiCredential } from '../packages/adapters/official-api/src/index';

it('keeps the historical Kangyi alias outside all ordinary, connection and batch routes despite old enabled flags', () => {
  const credentials: CredentialStore = { get: () => { throw Error('UNEXPECTED_CREDENTIAL_READ'); }, has: () => false, set: () => { throw Error('UNEXPECTED_WRITE'); }, delete: () => { throw Error('UNEXPECTED_WRITE'); } };
  const registry = createRuntimeAdapterRegistry(credentials, false);
  expect(registry.tryGetForConnection('kangyi_website')).toBeNull();
  expect(registry.listAll().some(adapter => adapter.platformKey === 'kangyi_website')).toBe(false);
  expect(productPlatform('kangyi_website')).toBeUndefined();
  expect(operatorPublishBlockReason('kangyi_website')).toBeTruthy();
  expect(PRODUCT_PLATFORM_POLICY.filter(platform => platform.ordinaryPublishEnabled).map(platform => platform.platformKey)).toEqual(['douyin', 'website', 'toutiao']);
  expect(PRODUCT_PLATFORM_POLICY.some(platform => platform.batchPublishEnabled)).toBe(false);
});

it('reads current Website credentials only from its exact namespace without a historical alias fallback', () => {
  const reads: string[] = [];
  const credentials: CredentialStore = { get: key => { reads.push(key); if (key.includes('kangyi_website')) throw Error('ALIAS_FALLBACK'); return null; }, has: () => false, set: () => {}, delete: () => {} };
  expect(() => readOfficialApiCredential(credentials, 'synthetic-current-account')).toThrow();
  expect(reads.length).toBeGreaterThan(0);
  expect(reads.every(key => key.startsWith('account:synthetic-current-account:website:'))).toBe(true);
  expect(officialApiCredentialRef('synthetic-current-account', 'secret')).toBe('account:synthetic-current-account:website:secret');
});
