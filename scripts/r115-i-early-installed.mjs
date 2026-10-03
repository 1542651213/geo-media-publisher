/* global window */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { isolatedEnv } from './r115-g-installed-helpers.mjs';

// Acceptance harness only. Pause before packaged Main, block network, then let
// the unchanged product startup, migrations and (when allowed) Scheduler run.
export const guard = new Function('electron', 'input', `
 const require=process.mainModule.require.bind(process.mainModule),fs=require('node:fs');
 if(process.env.GMP_B01_ISOLATED_USER_DATA_DIR!==input.userData||!input.userData.endsWith('b01-isolated-user-data')||!fs.existsSync(input.userData))throw Error('EARLY_ISOLATION_REQUIRED');
 globalThis.__hElectron=electron;globalThis.__hNetwork={blocked:0,loopback:0,beforeMain:true};
 const allowed=new Set(input.origins),check=raw=>{const url=new URL(String(raw?.url??raw));if(allowed.has(url.origin)){globalThis.__hNetwork.loopback++;return;}globalThis.__hNetwork.blocked++;throw Error('H_EXTERNAL_NETWORK_DENIED');};
 const fetch=globalThis.fetch;globalThis.fetch=(url,options)=>{check(url);return fetch(url,options);};
 for(const name of ['node:http','node:https']){const module=require(name);for(const method of ['request','get']){const original=module[method];module[method]=function(...args){let raw=args[0];if(raw&&typeof raw==='object'&&!(raw instanceof URL))raw=(raw.protocol??(name==='node:https'?'https:':'http:'))+'//'+(raw.hostname??raw.host??'localhost')+(raw.port?':'+raw.port:'')+(raw.path??'/');check(raw);return original.apply(this,args);};}}
 const connect=require('node:net').Socket.prototype.connect;require('node:net').Socket.prototype.connect=function(...args){const value=args[0],host=typeof value==='object'?value.host:typeof args[1]==='string'?args[1]:null;if(host&&!['127.0.0.1','::1','localhost'].includes(host)){globalThis.__hNetwork.blocked++;throw Error('H_EXTERNAL_SOCKET_DENIED');}return connect.apply(this,args);};
 electron.app.once('ready',()=>{if(electron.app.getPath('userData')!==input.userData)throw Error('MAIN_ISOLATION_MISMATCH');electron.session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(details,callback)=>{try{check(details.url);callback({cancel:false});}catch{callback({cancel:true});}});});
 let denied=false;try{globalThis.fetch('https://r115-h-deny-proof.invalid/');}catch{denied=true;}if(!denied)throw Error('NETWORK_DENY_FAILED');
 const recordExit=()=>process.stderr.write('\\n__R115_I_GUARD_EXIT__'+JSON.stringify(globalThis.__hNetwork)+'\\n');electron.app.once('will-quit',recordExit);const appExit=electron.app.exit.bind(electron.app);electron.app.exit=(...args)=>{recordExit();return appExit(...args);}; return {pid:process.pid,guardInstalledBeforeMain:true,beforeMain:true,denyProof:denied,blocked:globalThis.__hNetwork.blocked};
`);

export async function earlyInstalled(executable, userData, { origins = [], beforeMain = null, fixture = null, expectNoWindowExit = false, cwd = resolve(userData, '..', 'empty-working-directory') } = {}) {
  assert.ok(existsSync(executable)); assert.ok(existsSync(userData)); assert.equal(resolve(userData), userData);
  for (const origin of origins) assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname));
  const env = isolatedEnv(userData); delete env.NODE_PATH; delete env.NODE_OPTIONS; env.TEMP = resolve(userData, '..', 'temp'); env.TMP = env.TEMP; env.PATH = process.env.SystemRoot + '\\System32;' + process.env.SystemRoot + '\\System32\\WindowsPowerShell\\v1.0;' + process.env.SystemRoot;
  for (const key of Object.keys(env)) if (/BENCHMARK|READONLY_JOB_ID|ACCEPTANCE|NATIVE_SUBMIT|BROWSER_NATIVE_SUBMIT/u.test(key)) delete env[key];
  const processHandle = spawn(executable, ['--inspect-brk=0', '--remote-debugging-port=0'], { env, cwd, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  const exit = new Promise(done => processHandle.once('exit', done));
  let socket, rendererUrl, startupGuard, finalNetwork, seq = 0, nodeConnected = false, injected = false, resolveReady, rejectReady;
  const ready = new Promise((yes, no) => { resolveReady = yes; rejectReady = no; }), pending = new Map();
  const send = (method, params = {}) => new Promise((yes, no) => {
    const id = ++seq, timer = setTimeout(() => { pending.delete(id); no(Error('DEBUGGER_RESPONSE_TIMEOUT:' + method)); }, 12000);
    pending.set(id, { yes, no, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  processHandle.once('error', rejectReady);
  processHandle.stderr.on('data', bytes => {
    const text = bytes.toString();const ended=/__R115_I_GUARD_EXIT__(\{[^\r\n]+\})/u.exec(text);if(ended){finalNetwork=JSON.parse(ended[1]);socket?.close();}const renderer = /DevTools listening on (ws:\/\/[^\s]+)/u.exec(text);
    if (renderer) rendererUrl = renderer[1];
    const node = /Debugger listening on (ws:\/\/[^\s]+)/u.exec(text); if (!node || nodeConnected) return;
    nodeConnected = true; socket = new WebSocket(node[1]);
    socket.onmessage = async ({ data }) => {
      try {
        const message = JSON.parse(data);
        if (message.id) { const task = pending.get(message.id); if (task) { pending.delete(message.id); clearTimeout(task.timer); if (message.error) task.no(Error('DEBUGGER_PROTOCOL_ERROR')); else task.yes(message.result); } return; }
        if (message.method === 'Debugger.paused' && !injected) {
          injected = true;
          const callFrameId = message.params.callFrames[0].callFrameId;
          const result = await send('Debugger.evaluateOnCallFrame', { callFrameId, expression: `(${guard.toString()})(require('electron'),${JSON.stringify({ userData, origins })})`, returnByValue: true });
          if (result.exceptionDetails) throw Error('EARLY_NETWORK_GUARD_FAILED'); assert.equal(result.result.value.pid, processHandle.pid);startupGuard=result.result.value;
          if (beforeMain) { const setup = await send('Debugger.evaluateOnCallFrame', { callFrameId, expression: `(${beforeMain.toString()})(require('electron'),${JSON.stringify(fixture)})`, returnByValue: true }); if (setup.exceptionDetails) throw Error('EARLY_FIXTURE_FAILED'); }
          await send('Debugger.resume'); resolveReady();
        }
      } catch (error) { rejectReady(error); }
    };
    socket.onopen = async () => { try { await send('Debugger.enable'); await send('Runtime.runIfWaitingForDebugger'); } catch (error) { rejectReady(error); } };
  });
  let timer, browser;
  try {
    await Promise.race([ready, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('EARLY_MAIN_GUARD_TIMEOUT')), 20000); })]); clearTimeout(timer);
    if (expectNoWindowExit) {
      let ending;
      try {
        await Promise.race([exit, new Promise((_, reject) => { ending = setTimeout(() => reject(Error('SECOND_INSTANCE_DID_NOT_EXIT')), 10000); })]);
        assert.ok(finalNetwork, 'Second instance exit must retain its network receipt');
        return { pid: processHandle.pid, exitCode: processHandle.exitCode, guard: startupGuard, network: finalNetwork };
      } finally { clearTimeout(ending); socket?.close(); }
    }
    const started = Date.now(); while (!rendererUrl && Date.now() - started < 10000) await new Promise(done => setTimeout(done, 50));
    assert.ok(rendererUrl, 'RENDERER_ENDPOINT_REQUIRED'); browser = await chromium.connectOverCDP('http://127.0.0.1:' + new URL(rendererUrl).port);
    let page; while (Date.now() - started < 20000) { page = browser.contexts()[0]?.pages()[0]; if (page) break; await new Promise(done => setTimeout(done, 50)); }
    assert.ok(page); page.setDefaultTimeout(15000); await page.getByLabel('当前企业工作区').waitFor();
    const evaluate = async (fn, input) => { const result = await send('Runtime.evaluate', { expression: `(${fn.toString()})(globalThis.__hElectron,${JSON.stringify(input ?? null)})`, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw Error('PRIVATE_MAIN_EVALUATION_FAILED'); return result.result.value; };
    return { page, evaluate, childProcess:processHandle, guard:startupGuard, exit, networkExit:()=>finalNetwork, dispose:async()=>{socket?.close();await browser.close().catch(()=>{});}, pid: processHandle.pid, build: await page.evaluate(() => window.publisherAPI.product.buildIdentity()), close: async () => {
      await evaluate(electron => {setImmediate(()=>electron.app.quit());return true;}); socket.close(); let closeTimer;
      try { await Promise.race([exit, new Promise((_, reject) => { closeTimer = setTimeout(() => reject(Error('OWNED_MAIN_EXIT_TIMEOUT')), 15000); })]); }
      finally { clearTimeout(closeTimer); await browser.close().catch(() => {}); }
    } };
  } catch (error) {
    clearTimeout(timer); socket?.close(); await browser?.close().catch(() => {});
    if (processHandle.exitCode === null) execFileSync('taskkill.exe', ['/PID', String(processHandle.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    await exit; throw error;
  }
}

