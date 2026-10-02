import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import Database from 'better-sqlite3';

// Electron RUN_AS_NODE, closed synthetic data only. Never a production path.
const receipt = resolve(process.argv[2] ?? '');
assert.ok(process.argv[2] && receipt.startsWith(resolve('output/r115-h-execution-20261003')) && process.versions.electron);
const data = JSON.parse(readFileSync(receipt, 'utf8')) as { kind: string; status: string; label: string; userData: string; error?: string; samples: Array<{ measurements: Array<{ name: string; elapsedMs: number }> }> };
assert.equal(data.kind, 'INSTALLED_SYNTHETIC_JOBS_PROFILE'); assert.equal(data.samples.length, 5);
assert.ok(existsSync(join(data.userData, 'h-synthetic-performance-fixture.json')));
const db = new Database(join(data.userData, 'production-data/publisher.db'), { readonly: true });
try {
  const count = (table: string): number => (db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as { n: number }).n;
  const database = { integrity: db.pragma('integrity_check', { simple: true }), foreignKeys: db.pragma('foreign_key_check'), articles: count('articles'), images: count('media_assets'), jobs: count('publish_jobs') };
  assert.equal(database.integrity, 'ok'); assert.deepEqual(database.foreignKeys, []); assert.equal(database.articles, 3000); assert.equal(database.images, 1000); assert.equal(database.jobs, 10000);
  const statistics = Object.fromEntries(data.samples[0]!.measurements.map(item => {
    const values = data.samples.map(sample => { assert.equal(sample.measurements.length, 5); const measurement = sample.measurements.find(value => value.name === item.name); assert.ok(measurement); return measurement.elapsedMs; }).sort((a, b) => a - b);
    return [item.name, { samples: 5, medianMs: values[2], p95NearestRankMs: values[4], minMs: values[0], maxMs: values[4] }];
  }));
  const completed = join(dirname(receipt), 'performance-completed.json');
  writeFileSync(completed, JSON.stringify({ ...data, originalProbeFailure: data.error ?? null, error: undefined, database, statistics, status: 'PASS', supplementalCheck: 'CLOSED_SYNTHETIC_READONLY_DATABASE' }, null, 2));
  writeFileSync(resolve(`output/r115-h-execution-20261003/latest-performance-${data.label}.json`), JSON.stringify({ receipt: completed }));
} finally { db.close(); }
