import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const baseline = '0498be171588324c6d65eb593e216dab70526192';
const git = (...args) => execFileSync('git', ['-c', `safe.directory=${process.cwd().replaceAll('\\', '/')}`, ...args], { encoding: 'utf8' }).trim();
const frozen = ['apps/desktop/src/main', 'apps/desktop/src/shared', 'packages', 'PLATFORMS.csv', 'package.json', 'pnpm-lock.yaml'];
const changed = git('diff', '--name-only', baseline, '--', ...frozen).split('\n').filter(Boolean);
assert.deepEqual(changed, [], 'H2 changes a frozen Main/IPC/domain/database/adapter/policy file');
assert.equal(git('ls-files', '--others', '--exclude-standard', '--', ...frozen), '', 'Untracked frozen-layer addition');
const tracked = git('ls-files', '--', ...frozen).split('\n').filter(Boolean);
assert.equal(git('diff', '--name-only', '--', ...frozen), '', 'Uncommitted frozen-file edits');
const config = git('diff', baseline, '--', 'electron.vite.config.ts');
if (config) {
  const lines = config.split('\n').filter(line => /^[+-][^+-]/u.test(line));
  assert.equal(lines.length, 2, 'Build config change exceeds one metadata line');
  assert.equal(lines[0].slice(1).replace("deliveryId:'R1.15-H.1'", "deliveryId:'R1.15-H.2'"), lines[1].slice(1), 'Only Candidate delivery identity may change');
}
const result = { status: 'PASS', baseline, head: git('rev-parse', 'HEAD'), frozenFileCount: tracked.length, changedFrozenFiles: changed, functionalSemanticsChanged: false, databaseSchemaChanged: false, ipcContractChanged: false, publishGateChanged: false, finalSubmitChanged: false, buildMetadataException: 'deliveryId R1.15-H.2 only' };
const target = resolve(process.argv[2] ?? 'output/r115-h2-execution-20261003/semantic-freeze.json');
mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
