import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import xlsx from 'xlsx';
const evidence = resolve('output/r115-i-execution-20261003'), privateRoot = resolve(process.argv[2] ?? '');
assert.ok(process.argv[2] && existsSync(privateRoot) && !privateRoot.toLowerCase().startsWith(resolve('.').toLowerCase()));
const bundle = JSON.parse(readFileSync(join(evidence, 'handoff-bundle.json'), 'utf8'));
const powershell = join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
const extracted = join(evidence, 'extracted-handoff-' + Date.now()); mkdirSync(extracted);
const env = { ...process.env, I_BUNDLE_ZIP: bundle.zip, I_EXTRACT: extracted };
const listing = JSON.parse(execFileSync(powershell, ['-NoProfile', '-Command', 'Add-Type -AssemblyName System.IO.Compression.FileSystem;$zip=[IO.Compression.ZipFile]::OpenRead($env:I_BUNDLE_ZIP);try{@($zip.Entries|ForEach-Object{$_.FullName})|ConvertTo-Json -Compress}finally{$zip.Dispose()}'],
 { env, encoding: 'utf8', windowsHide: true }));
for (const name of listing) assert.ok(name.startsWith('GEO-R115I-DEPARTMENT-PILOT/') && !name.includes('..') && !/^[\\/]|^[a-z]:/iu.test(name), 'BUNDLE_ENTRY_SCOPE_INVALID');
execFileSync(powershell, ['-NoProfile', '-Command', 'Add-Type -AssemblyName System.IO.Compression.FileSystem;[IO.Compression.ZipFile]::ExtractToDirectory($env:I_BUNDLE_ZIP,$env:I_EXTRACT)'], { env, windowsHide: true });
const root = join(extracted, 'GEO-R115I-DEPARTMENT-PILOT'), sha = data => createHash('sha256').update(data).digest('hex');
const checksums = readFileSync(join(root, 'SHA256SUMS.txt'), 'utf8').trim().split(/\r?\n/u);
for (const line of checksums) {
 const match = /^([a-f0-9]{64}) {2}(.+)$/u.exec(line); assert.ok(match);
 const file = resolve(root, match[2]); assert.ok(file.startsWith(root + '\\')); assert.equal(sha(readFileSync(file)), match[1], 'BUNDLE_CHECKSUM_MISMATCH');
}
const files = folder => readdirSync(folder, { withFileTypes: true }).flatMap(entry => { assert.equal(entry.isSymbolicLink(), false); return entry.isDirectory() ? files(join(folder, entry.name)) : [join(folder, entry.name)]; });
const all = files(root); assert.equal(all.length, bundle.files);
const forbidden = /(?:^|[\\/])(?:publisher\.db(?:-(?:wal|shm))?|credentials\.enc|Local State|Cookies?|StorageState\.json|browser-profiles|production-data|private|backup)(?:[\\/]|$)|\.(?:secret|db|sqlite|pfx|pem)$/iu;
assert.equal(all.filter(file => forbidden.test(file.slice(root.length))).length, 0);
const templates = join(root, 'docs/product/r115-i-pilot-preview/templates'), strings = {};
for (const name of readdirSync(templates)) {
 if (!/\.(?:xlsx|csv)$/iu.test(name)) continue;
 const workbook = xlsx.readFile(join(templates, name), { bookVBA: true }); assert.equal(Boolean(workbook.vbaraw), false);
 strings[name] = workbook.SheetNames.map(sheet => xlsx.utils.sheet_to_json(workbook.Sheets[sheet], { header: 1, defval: '' }));
 if (name.endsWith('.xlsx')) {
  const zipEnv = { ...process.env, I_WORKBOOK: join(templates, name) };
  const names = JSON.parse(execFileSync(powershell, ['-NoProfile', '-Command', 'Add-Type -AssemblyName System.IO.Compression.FileSystem;$zip=[IO.Compression.ZipFile]::OpenRead($env:I_WORKBOOK);try{@($zip.Entries|ForEach-Object{$_.FullName})|ConvertTo-Json -Compress}finally{$zip.Dispose()}'], { env: zipEnv, encoding: 'utf8', windowsHide: true }));
  assert.equal(names.some(path => /vbaProject|externalLinks|connections\.xml/iu.test(path)), false);
 }
}
writeFileSync(join(extracted, 'inspected-synthetic-template-cells.json'), JSON.stringify(strings));
const report = join(privateRoot, 'handoff-secret-scan-' + Date.now() + '.json');
const scan = spawnSync('gitleaks', ['dir', extracted, '--redact=100', '--no-banner', '--report-format=json', '--report-path=' + report], { encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
writeFileSync(report + '.log', (scan.stdout ?? '') + (scan.stderr ?? '')); assert.ok([0, 1].includes(scan.status));
const matches = JSON.parse(readFileSync(report, 'utf8')); assert.equal(matches.length, 0, 'HANDOFF_SECRET_SCAN_FAILED_REVIEW_PRIVATE_REPORT');
const parameters = JSON.parse(readFileSync(join(evidence, 'final-package-parameters.json'), 'utf8'));
const validation = spawnSync(powershell, ['-NoProfile', '-File', join(root, 'Start-Pilot.ps1'), '-InstallDirectory', parameters.installDirectory,
 '-PilotDirectory', join(extracted, 'GEO-Department-Pilot-R115I'), '-ValidateOnly'], { encoding: 'utf8', windowsHide: true });
assert.equal(validation.status, 0); assert.equal(existsSync(join(extracted, 'GEO-Department-Pilot-R115I')), false);
const result = { status: 'PASS', zipSha256: sha(readFileSync(bundle.zip)), entries: listing.length, files: all.length,
 allExtractedFileHashesMatched: true, installerIdentityMatched: true, launcherValidatesFromExtractedBundle: true, validateOnlyNoProfileWrites: true,
 secretFindings: 0, forbiddenPaths: 0, templateMacroAndExternalLinkCount: 0, templateCellStringsScanned: true, privateArtifactsIncluded: false,
 extractionDirectory: root };
writeFileSync(join(evidence, 'handoff-verification.json'), JSON.stringify(result, null, 2));
bundle.status = 'VERIFIED'; writeFileSync(join(evidence, 'handoff-bundle.json'), JSON.stringify(bundle, null, 2));
console.log(JSON.stringify({ status: result.status, files: result.files, zipSha256: result.zipSha256, secretFindings: 0 }));
