import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { earlyInstalled } from './r115-i-early-installed.mjs';
export { nav, tab, pickFile, selectCompany, waitForIpcCondition, mainDatabase } from './r115-h2-installed-helpers.mjs';

export const evidenceRoot = resolve('output/r115-i-execution-20261003');
export const pilotRoot = resolve('D:/GEO_MEDIA_PUBLISHER_FINAL/pilot/r115-i-20261003');
export function freshProfile(label) {
  assert.match(label, /^[a-z0-9-]+$/u);
  const root = join(pilotRoot, `${label}-${Date.now()}`);
  for (const name of ['b01-isolated-user-data', 'session-data', 'logs', 'temp', 'empty-working-directory', 'media']) mkdirSync(join(root, name), { recursive: true });
  return { root, userData: join(root, 'b01-isolated-user-data') };
}
export const beforePilotMain = new Function('electron', 'input', `
 const require=process.mainModule.require.bind(process.mainModule),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
 const root=path.dirname(input.userData),canonical=path.resolve(input.canonical).toLowerCase();
 for(const name of ['session-data','logs','temp','media'])if(!fs.statSync(path.join(root,name)).isDirectory())throw Error('PILOT_PATHS_NOT_PREPARED');
 electron.app.setPath('sessionData',path.join(root,'session-data'));electron.app.setPath('temp',path.join(root,'temp'));electron.app.setAppLogsPath(path.join(root,'logs'));
 globalThis.__iIndependent={sourceReads:0,sourceModules:0,cwdIndependent:process.cwd()===path.join(root,'empty-working-directory'),nodePathAbsent:!process.env.NODE_PATH,nodeOptionsAbsent:!process.env.NODE_OPTIONS,sessionDataIsolated:true,tempIsolated:true,logsIsolated:true};
 const sourcePath=value=>{if(typeof value!=='string'&&!Buffer.isBuffer(value)&&!(value instanceof URL))return false;const real=path.resolve(value instanceof URL?require('node:url').fileURLToPath(value):String(value)).toLowerCase();return real===canonical||real.startsWith(canonical+path.sep);};
 for(const name of ['readFileSync','readFile','openSync','open','statSync','stat','lstatSync','lstat','readdirSync','readdir','existsSync']){const original=fs[name];fs[name]=function(value,...args){if(sourcePath(value)){globalThis.__iIndependent.sourceReads++;throw Error('PILOT_SOURCE_ACCESS_DENIED');}return original.call(this,value,...args);};}
 const resolveFilename=Module._resolveFilename;Module._resolveFilename=function(...args){const value=resolveFilename.apply(this,args);if(sourcePath(value)){globalThis.__iIndependent.sourceModules++;throw Error('PILOT_SOURCE_MODULE_DENIED');}return value;};
 return globalThis.__iIndependent;
`);
export async function launchPilot(executable, userData, options = {}) {
  assert.ok(existsSync(executable));
  const run = await earlyInstalled(executable, userData, { beforeMain: beforePilotMain, fixture: { userData, canonical: resolve('.') }, ...options });
  if (run.build) { assert.equal(run.build.packaged, true); assert.ok(['R1.15-H.2', 'R1.15-I'].includes(run.build.deliveryId)); }
  if (run.evaluate) {
    const paths = await run.evaluate(electron => Object.fromEntries(['userData', 'sessionData', 'logs', 'temp'].map(name => [name, electron.app.getPath(name)])));
    const root = resolve(userData, '..');
    assert.equal(paths.userData, userData); assert.equal(paths.sessionData, join(root, 'session-data')); assert.equal(paths.logs, join(root, 'logs')); assert.equal(paths.temp, join(root, 'temp'));
    run.paths = paths;
  }
  return run;
}
export function saveEvidence(name, data) { writeFileSync(join(evidenceRoot, name + '.json'), JSON.stringify(data, null, 2)); }
