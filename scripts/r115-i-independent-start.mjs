/* global window */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright-core';
import { freshProfile, beforePilotMain, saveEvidence, nav } from './r115-i-installed-helpers.mjs';
import { guard } from './r115-i-early-installed.mjs';
import { isolatedEnv } from './r115-g-installed-helpers.mjs';
const pointer = resolve('output/r115-i-execution-20261003/independent-start-pointer.json');
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const until = async (fn, label, timeout = 15000) => { const deadline = Date.now() + timeout; while (Date.now() < deadline) { const value = fn(); if (value) return value; await new Promise(done => setTimeout(done, 50)); } throw Error(label); };
const inspector = async url => {
  const socket = new WebSocket(url); let sequence = 0; const pending = new Map(), listeners = [];
  await new Promise((yes, no) => { socket.onopen = yes; socket.onerror = no; });
  socket.onmessage = ({ data }) => { const message = JSON.parse(data); if (message.id) { const task = pending.get(message.id); if (task) { clearTimeout(task.timer); pending.delete(message.id); if (message.error) task.no(Error('INSPECTOR_PROTOCOL_FAILURE')); else task.yes(message.result); } } else for (const listener of listeners) listener(message); };
  const send = (method, params = {}) => new Promise((yes, no) => { const id = ++sequence, timer = setTimeout(() => { pending.delete(id); no(Error('INSPECTOR_TIMEOUT:' + method)); }, 15000); pending.set(id, { yes, no, timer }); socket.send(JSON.stringify({ id, method, params })); });
  return { socket, send, listeners };
};
if (!process.argv.includes('--verify')) {
  const executable = resolve(process.argv[2]), profile = freshProfile('independent-controller-exit'), stderr = join(profile.root, 'owned-main-stderr.log'), fd = openSync(stderr, 'a');
  const env = isolatedEnv(profile.userData); for (const key of Object.keys(env)) if (/ACCEPTANCE|BENCHMARK|NATIVE_SUBMIT|NODE_PATH|NODE_OPTIONS/u.test(key)) delete env[key];
  env.TEMP = join(profile.root, 'temp'); env.TMP = env.TEMP; env.PATH = process.env.SystemRoot + '\\System32;' + process.env.SystemRoot + '\\System32\\WindowsPowerShell\\v1.0;' + process.env.SystemRoot;
  const child = spawn(executable, ['--inspect-brk=0', '--remote-debugging-port=0'], { detached: true, env, cwd: join(profile.root, 'empty-working-directory'), windowsHide: true, stdio: ['ignore', 'ignore', fd] });
  let connection;
  try {
    const nodeUrl = await until(() => /Debugger listening on (ws:\/\/\S+)/u.exec(readFileSync(stderr, 'utf8'))?.[1], 'INSPECTOR_MISSING');
    connection = await inspector(nodeUrl);
    const paused = new Promise((yes, no) => { let injected = false; connection.listeners.push(async message => {
      if (message.method !== 'Debugger.paused' || injected) return; injected = true;
      try {
        const frame = message.params.callFrames[0].callFrameId, input = { userData: profile.userData, canonical: resolve('.'), origins: [] };
        for (const fn of [guard, beforePilotMain]) { const value = await connection.send('Debugger.evaluateOnCallFrame', { callFrameId: frame, expression: '(' + fn.toString() + ")(require('electron')," + JSON.stringify(input) + ')', returnByValue: true }); assert.ok(!value.exceptionDetails); }
        await connection.send('Debugger.resume'); yes();
      } catch (error) { no(error); }
    }); });
    await connection.send('Debugger.enable'); await connection.send('Runtime.runIfWaitingForDebugger'); await paused;
    const rendererUrl = await until(() => /DevTools listening on (ws:\/\/\S+)/u.exec(readFileSync(stderr, 'utf8'))?.[1], 'RENDERER_MISSING');
    const receipt = { executable, controllerPid: process.pid, mainPid: child.pid, nodeUrl, rendererUrl, stderr, ...profile };
    writeFileSync(pointer, JSON.stringify(receipt, null, 2)); connection.socket.close(); closeSync(fd); child.unref();
    console.log(JSON.stringify({ status: 'CONTROLLER_EXITING_MAIN_LEFT_RUNNING', controllerPid: receipt.controllerPid, ownedMainPid: receipt.mainPid }));
  } catch (error) { connection?.socket.close(); closeSync(fd); execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); throw error; }
} else {
  const receipt = JSON.parse(readFileSync(pointer, 'utf8')); assert.equal(alive(receipt.controllerPid), false, 'Original acceptance controller must have exited'); assert.equal(alive(receipt.mainPid), true);
  const connection = await inspector(receipt.nodeUrl); let browser, verifiedOwned = false;
  const evaluate = async fn => { const value = await connection.send('Runtime.evaluate', { expression: '(' + fn.toString() + ')(globalThis.__hElectron)', awaitPromise: true, returnByValue: true }); assert.ok(!value.exceptionDetails); return value.result.value; };
  try {
    const actual = await evaluate(electron => ({ pid: process.pid, userData: electron.app.getPath('userData'), independent: globalThis.__iIndependent, network: globalThis.__hNetwork }));
    assert.equal(actual.pid, receipt.mainPid); assert.equal(actual.userData, receipt.userData); verifiedOwned = true;
    assert.equal(actual.independent.sourceReads, 0); assert.equal(actual.independent.sourceModules, 0); assert.equal(actual.independent.nodePathAbsent, true); assert.equal(actual.independent.cwdIndependent, true);
    browser = await chromium.connectOverCDP('http://127.0.0.1:' + new URL(receipt.rendererUrl).port); const page = browser.contexts()[0].pages()[0];
    assert.ok(page.url().startsWith('file:')); await page.getByLabel('当前企业工作区').waitFor(); await nav(page, '设置'); await page.getByRole('heading', { name: '关于此版本', exact: true }).waitFor();
    const build = await page.evaluate(() => window.publisherAPI.product.buildIdentity()); assert.equal(build.deliveryId, 'R1.15-I'); assert.equal(build.packaged, true);
    await evaluate(electron => { setImmediate(() => electron.app.quit()); return true; }); connection.socket.close(); await browser.close().catch(() => {}); browser = null;
    await until(() => !alive(receipt.mainPid), 'OWNED_INDEPENDENT_MAIN_DID_NOT_EXIT');
    const exit = /__R115_I_GUARD_EXIT__(\{[^\r\n]+\})/u.exec(readFileSync(receipt.stderr, 'utf8')); assert.ok(exit); const network = JSON.parse(exit[1]); assert.equal(network.beforeMain, true); assert.equal(network.loopback, 0); assert.equal(network.blocked, 1);
    const result = { status: 'PASS', kind: 'SAME_MACHINE_PACKAGED_MAIN_SURVIVES_ACCEPTANCE_CONTROLLER_EXIT', controllerExitedBeforeObservation: true, mainContinuedAndOrdinaryUiResponded: true, rendererLoadedFromInstalledFile: true, independent: actual.independent, network, build, newWindowsMachine: 'NOT_RUN', codexDesktopProcessStopped: false, productionWrites: 0 };
    saveEvidence('independent-start', result); console.log(JSON.stringify({ status: result.status, controllerExitProved: true, sourceReads: actual.independent.sourceReads, newWindowsMachine: 'NOT_RUN' }));
  } catch (error) { if (verifiedOwned && alive(receipt.mainPid)) execFileSync('taskkill.exe', ['/PID', String(receipt.mainPid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); throw error; }
  finally { connection.socket.close(); await browser?.close().catch(() => {}); }
}
