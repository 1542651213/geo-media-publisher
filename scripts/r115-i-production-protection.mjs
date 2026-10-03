import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { saveEvidence } from './r115-i-installed-helpers.mjs';
const privateRoot = resolve(process.argv[2] ?? '');
assert.ok(process.argv[2] && !privateRoot.toLowerCase().startsWith(resolve('.').toLowerCase()));
const baseline = JSON.parse(readFileSync(join(privateRoot, 'production-before.json'), 'utf8'));
const production = join(process.env.APPDATA, 'codex-media-publisher'), current = {}, links = [];
const walk = folder => {
 for (const entry of readdirSync(folder, { withFileTypes: true })) {
  const path = join(folder, entry.name);
  if (entry.isSymbolicLink()) { links.push(path.slice(production.length + 1)); continue; }
  if (entry.isDirectory()) walk(path);
  else {
   const key = path.slice(production.length + 1), bytes = readFileSync(path);
   current[key] = { bytes: statSync(path).size, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
 }
};
walk(production);
const missing = Object.keys(baseline.files).filter(key => !current[key]), added = Object.keys(current).filter(key => !baseline.files[key]);
const changed = Object.keys(baseline.files).filter(key => current[key] && (current[key].sha256 !== baseline.files[key].sha256 || current[key].bytes !== baseline.files[key].bytes));
writeFileSync(join(privateRoot, 'production-comparison-' + Date.now() + '.json'), JSON.stringify({ changed, missing, added, links, current }));
const result = { status: changed.length || missing.length || added.length || links.length ? 'FAIL_PRESERVE_AND_REVIEW' : 'PASS',
 baselineFiles: Object.keys(baseline.files).length, currentFiles: Object.keys(current).length, changedFiles: changed.length,
 missingFiles: missing.length, addedFiles: added.length, unexpectedLinks: links.length, method: 'Read-only byte length and SHA256 of every original production file; no database open or credential decryption',
 productionWrites: 0, allOriginalFileBytesUnchanged: changed.length === 0 && missing.length === 0 && added.length === 0 };
saveEvidence('production-protection', result); console.log(JSON.stringify(result)); if (result.status !== 'PASS') process.exitCode = 1;
