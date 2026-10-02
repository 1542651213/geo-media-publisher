import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { resolveRuntimePaths } from '../apps/desktop/src/main/runtime-paths';
const roots: string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(){const root=mkdtempSync(join(tmpdir(),'r115-g-paths-'));roots.push(root);const original=join(root,'owner');mkdirSync(original);const isolated=join(root,'b01-isolated-user-data');mkdirSync(isolated);return {root,original,isolated};}
it('resolves every storage boundary before initialization',()=>{const {original,isolated}=fixture();const paths=resolveRuntimePaths(original,isolated,true);expect(paths.userData).toBe(isolated);for(const path of [paths.database,paths.credentials,paths.browserProfiles,paths.localState])expect(path.startsWith(isolated)).toBe(true);});
it('rejects production children, invalid or missing isolation directories',()=>{const {original,isolated}=fixture();const unsafe=join(original,'b01-isolated-user-data');mkdirSync(unsafe);expect(()=>resolveRuntimePaths(original,unsafe,true)).toThrow('ISOLATED_PATH_UNSAFE');expect(()=>resolveRuntimePaths(original,original,true)).toThrow();expect(()=>resolveRuntimePaths(original,join(isolated,'missing'),true)).toThrow();expect(()=>resolveRuntimePaths(original,'b01-isolated-user-data',true)).toThrow();});
it('keeps development and production database modes explicit',()=>{const {original}=fixture();expect(resolveRuntimePaths(original,undefined,false).database).toBe(join(original,'development-data','publisher.db'));expect(resolveRuntimePaths(original,undefined,true).database).toBe(join(original,'production-data','publisher.db'));});
