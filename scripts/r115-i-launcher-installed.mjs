/* global window */
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { chromium } from 'playwright-core';
import { guard } from './r115-i-early-installed.mjs';
import { freshProfile, beforePilotMain, mainDatabase, saveEvidence } from './r115-i-installed-helpers.mjs';
const executable = resolve(process.argv[2]), install = resolve(executable, '..'), sample = freshProfile('actual-pilot-launcher');
const root = join(sample.root, 'GEO-Department-Pilot-R115I'), userData = join(root, 'b01-isolated-user-data');
for (const folder of ['session-data', 'logs', 'temp', 'media', 'empty-working-directory']) mkdirSync(join(root, folder), { recursive: true });
const launcherDirectory = join(sample.root, 'public-launcher'); cpSync('docs/product/pilot-launcher', launcherDirectory, { recursive: true });
const port = async () => { const server = createServer(); await new Promise(done => server.listen(0, '127.0.0.1', done)); const value = server.address().port; await new Promise(done => server.close(done)); return value; };
const until = async fn => { const end = Date.now() + 18000; while (Date.now() < end) { try { const value = await fn(); if (value) return value; } catch { /* Endpoint not ready yet. */ } await new Promise(done => setTimeout(done, 50)); } throw Error('OWNED_LAUNCHER_START_TIMEOUT'); };
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
// Test-only Start-Process wrapper forwards the launcher's actual file/cwd/env.
// It adds only pre-Main inspector flags and Hidden for an unattended test.
// The public launcher file, selection, manifest, data directory and env logic are unchanged.
const wrapper = join(sample.root, 'instrumented-public-launcher.ps1');
writeFileSync(wrapper, [
 'function Start-Process { param([string]$FilePath,[string]$WorkingDirectory,[string]$WindowStyle)',
 '$owned=Microsoft.PowerShell.Management\\Start-Process -FilePath $FilePath -WorkingDirectory $WorkingDirectory -ArgumentList $env:I_MAIN_FLAGS -WindowStyle Hidden -PassThru;',
 '[Console]::WriteLine(("__I_OWNED_PID__"+$owned.Id)); return $owned }',
 'if($env:I_REMEMBERED -eq "yes"){ . $env:I_ENTRY -PilotDirectory $env:I_PILOT }',
 'else{ . $env:I_ENTRY -InstallDirectory $env:I_INSTALL -PilotDirectory $env:I_PILOT }'
].join('\n'));
const powershell = join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
const receipts = []; let ownedPid, connection, browser;
async function launch(remembered) {
 const mainPort = await port(), rendererPort = await port();
 const env = { ...process.env, I_ENTRY: join(launcherDirectory, 'Start-Pilot.ps1'), I_PILOT: root, I_INSTALL: install,
  I_MAIN_FLAGS: '--inspect-brk=' + mainPort + ' --remote-debugging-port=' + rendererPort, I_REMEMBERED: remembered ? 'yes' : 'no',
  TEMP: join(root, 'temp'), TMP: join(root, 'temp'), PATH: process.env.SystemRoot + '\\System32;' + process.env.SystemRoot + '\\System32\\WindowsPowerShell\\v1.0;' + process.env.SystemRoot };
 delete env.NODE_PATH; delete env.NODE_OPTIONS; delete env.GMP_B01_ISOLATED_USER_DATA_DIR;
 const launched = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-File', wrapper], { env, encoding: 'utf8', windowsHide: true, timeout: 20000 });
 assert.equal(launched.status, 0, 'PUBLIC_LAUNCHER_FAILED'); const pid = /__I_OWNED_PID__(\d+)/u.exec(launched.stdout); assert.ok(pid); ownedPid = Number(pid[1]);
 const endpoint = await until(async () => (await (await fetch('http://127.0.0.1:' + mainPort + '/json/list')).json())[0]?.webSocketDebuggerUrl);
 const socket = new WebSocket(endpoint), pending = new Map(); let sequence = 0, injected = false;
 await new Promise((yes, no) => { socket.onopen = yes; socket.onerror = no; });
 const send = (method, params = {}) => new Promise((yes, no) => { const id = ++sequence, timer = setTimeout(() => { pending.delete(id); no(Error('LAUNCHER_DEBUGGER_TIMEOUT')); }, 12000); pending.set(id, { yes, no, timer }); socket.send(JSON.stringify({ id, method, params })); });
 connection = { socket, send };
 let yesReady, noReady; const ready = new Promise((yes, no) => { yesReady = yes; noReady = no; });
 socket.onmessage = async ({ data }) => {
  const message = JSON.parse(data);
  if (message.id) { const task = pending.get(message.id); if (task) { clearTimeout(task.timer); pending.delete(message.id); if (message.error) task.no(Error('LAUNCHER_PROTOCOL_ERROR')); else task.yes(message.result); } return; }
  if (message.method !== 'Debugger.paused' || injected) return; injected = true;
  try {
   const frame = message.params.callFrames[0].callFrameId, input = { userData, origins: [], canonical: resolve('.') };
   for (const fn of [guard, beforePilotMain]) {
    const value = await send('Debugger.evaluateOnCallFrame', { callFrameId: frame, expression: '(' + fn.toString() + ")(require('electron')," + JSON.stringify(input) + ')', returnByValue: true });
    assert.ok(!value.exceptionDetails, 'PRE_MAIN_LAUNCHER_GUARD_FAILED');
   }
   await send('Debugger.resume'); yesReady();
  } catch (error) { noReady(error); }
 };
 await send('Debugger.enable'); await send('Runtime.runIfWaitingForDebugger'); await ready;
 const evaluate = async fn => { const value = await send('Runtime.evaluate', { expression: '(' + fn.toString() + ')(globalThis.__hElectron)', awaitPromise: true, returnByValue: true }); assert.ok(!value.exceptionDetails); return value.result.value; };
 await until(async () => (await fetch('http://127.0.0.1:' + rendererPort + '/json/version')).ok);
 browser = await chromium.connectOverCDP('http://127.0.0.1:' + rendererPort);
 const page = browser.contexts()[0].pages()[0]; await page.getByLabel('当前企业工作区').waitFor(); page.setDefaultTimeout(15000);
 const actual = await evaluate(electron => ({ pid: process.pid, userData: electron.app.getPath('userData'), cwd: process.cwd(), isolation: globalThis.__iIndependent, network: globalThis.__hNetwork }));
 assert.equal(actual.pid, ownedPid); assert.equal(actual.userData, userData); assert.equal(actual.cwd, install);
 assert.equal(actual.isolation.sourceReads, 0); assert.equal(actual.isolation.sourceModules, 0); assert.equal(actual.network.beforeMain, true);
 const build = await page.evaluate(() => window.publisherAPI.product.buildIdentity()); assert.equal(build.deliveryId, 'R1.15-I');
 assert.equal(build.sourceCommit, JSON.parse(readFileSync(join(launcherDirectory, 'SOFTWARE.json'), 'utf8')).sourceCommit);
 return { page, evaluate, actual, build };
}
async function close(run) {
 const network = await run.evaluate(() => globalThis.__hNetwork); assert.equal(network.blocked, 1); assert.equal(network.loopback, 0);
 receipts.push({ rememberedInstallUsed: receipts.length > 0, network, sourceReads: run.actual.isolation.sourceReads, sourceModules: run.actual.isolation.sourceModules });
 await run.evaluate(electron => { setImmediate(() => electron.app.quit()); return true; }); connection.socket.close(); connection = null; await browser.close().catch(() => {}); browser = null;
 await until(() => !alive(ownedPid)); ownedPid = null;
}
try {
 let run = await launch(false);
 assert.equal((await run.page.evaluate(() => window.publisherAPI.brands.list())).length, 0);
 const counts = await run.evaluate(new Function('electron', 'return (' + mainDatabase.toString() + ')(electron,' + JSON.stringify({ userData }) + ');'));
 for (const table of ['accounts', 'publish_jobs', 'submission_intents', 'publish_records']) assert.equal(counts.counts[table], 0);
 await run.page.getByRole('button', { name: '创建企业资料', exact: true }).click(); await run.page.getByLabel('新企业名称', { exact: true }).fill('合成启动器企业'); await run.page.getByLabel('新企业简称', { exact: true }).fill('合成入口');
 await run.page.getByRole('button', { name: '创建企业', exact: true }).click(); await run.page.getByRole('heading', { name: '企业资料', exact: true, level: 2 }).waitFor(); await close(run);
 run = await launch(true); assert.equal((await run.page.evaluate(() => window.publisherAPI.brands.list()))[0].companyName, '合成启动器企业'); await close(run);
 const result = { status: 'PASS', kind: 'ACTUAL_PUBLIC_LAUNCHER_WITH_TEST_ONLY_PRE_MAIN_INSPECTOR_FLAGS', actualWindowsStartProcessUsed: true,
  launcherFilesUnchanged: true, currentManifestVerified: true, newProfileChosenByPublicLauncher: true, normalUiFirstCompany: true,
  rememberedInstallRestartPreservesNewProfile: true, noDirectSqlMutations: true, networkByStart: receipts, productionWrites: 0, securityPolicyChanged: false };
 saveEvidence('actual-launcher-installed', result); console.log(JSON.stringify(result));
} finally {
 connection?.socket.close(); await browser?.close().catch(() => {});
 if (ownedPid && alive(ownedPid)) execFileSync('taskkill.exe', ['/PID', String(ownedPid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
}
