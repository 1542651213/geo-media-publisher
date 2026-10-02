import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { z } from 'zod';
import { createClosedSnapshot, type FullSnapshotManifest, type SnapshotIdentity } from './backup-restore';

const requestSchema = z.strictObject({ token: z.uuid(), source: z.string(), directory: z.string(), parentPid: z.number().int().positive(), parentIdentity: z.string().min(1), workerPid: z.number().int().positive().nullable(), workerIdentity: z.string().min(1).nullable(), identity: z.strictObject({ appVersion: z.string(), sourceCommit: z.string(), deliveryId: z.string(), migrations: z.array(z.string()) }) });
type Request = z.infer<typeof requestSchema>;
export interface SnapshotHandoff { leasePath: string; token: string }
function leaseFor(source: string): string { return join(dirname(source), 'geo-full-snapshot-' + createHash('sha256').update(source.toLowerCase()).digest('hex').slice(0, 20) + '.lease.json'); }
function validatePaths(request: Request, leasePath: string): void {
  if (!isAbsolute(request.source) || !isAbsolute(request.directory) || !existsSync(request.source)
    || lstatSync(request.source).isSymbolicLink() || !lstatSync(request.source).isDirectory()
    || realpathSync(request.source) !== request.source || resolve(leasePath) !== leaseFor(request.source)
    || dirname(request.directory) !== join(dirname(request.source), 'geo-full-snapshots')
    || !/^snapshot-[\w-]+$/u.test(basename(request.directory))) throw new Error('SNAPSHOT_HANDOFF_PATH_INVALID');
  const destinationParent = dirname(request.directory);
  if (existsSync(destinationParent) && (lstatSync(destinationParent).isSymbolicLink() || realpathSync(destinationParent) !== destinationParent)) throw new Error('SNAPSHOT_HANDOFF_PATH_INVALID');
}
function readRequest(path: string): Request {
  if (lstatSync(path).isSymbolicLink() || lstatSync(path).size > 100_000) throw new Error('SNAPSHOT_HANDOFF_INVALID');
  const request = requestSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  validatePaths(request, path);
  return request;
}
function owned(handoff: SnapshotHandoff): Request {
  const request = readRequest(handoff.leasePath);
  if (request.token !== handoff.token) throw new Error('SNAPSHOT_HANDOFF_CHANGED');
  return request;
}
export function processAlive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; return true; } }
export function readWindowsProcessIdentity(pid: number, query = (): string => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$taskProcess = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($taskProcess) { $taskProcess.StartTime.ToUniversalTime().Ticks.ToString() }`], { windowsHide: true, encoding: 'utf8', timeout: 5_000 }), isAlive = processAlive): string | null {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('PROCESS_IDENTITY_INVALID');
  try {
    const stamp = query().trim();
    if (!/^\d+$/u.test(stamp)) throw new Error('PROCESS_IDENTITY_UNAVAILABLE');
    return stamp;
  } catch (error) {
    // Get-Process exits nonzero if the parent disappears during the query.
    // Accept only confirmed exit; a query failure for a live process stays closed.
    if (!isAlive(pid)) return null;
    throw error;
  }
}
export function processIdentity(pid: number): string | null {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('PROCESS_IDENTITY_INVALID');
  if (!processAlive(pid)) return null;
  if (process.platform === 'win32') {
    // Only the exact PID's creation time is read. No names, command lines or secrets.
    return readWindowsProcessIdentity(pid);
  }
  if (process.platform === 'linux') {
    try { const stat = readFileSync(`/proc/${pid}/stat`, 'utf8'); return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] ?? null; } catch { return null; }
  }
  throw new Error('PROCESS_IDENTITY_PLATFORM_UNSUPPORTED');
}
function finish(handoff: SnapshotHandoff, status: 'Complete' | 'Incomplete', details: Record<string, unknown>): void {
  const request = owned(handoff);
  writeFileSync(request.directory + '.status.json', JSON.stringify({ status, directory: request.directory, ...details }));
  // Only this coordination file is released. Snapshot content, including failures, is retained.
  owned(handoff);
  unlinkSync(handoff.leasePath);
}
export function assertSnapshotHandoffIdle(sourceRoot: string, isAlive = processAlive, identityOf = processIdentity): void {
  const source = realpathSync(sourceRoot), leasePath = leaseFor(source);
  if (!existsSync(leasePath)) return;
  const request = readRequest(leasePath);
  if ((isAlive(request.parentPid) && identityOf(request.parentPid) === request.parentIdentity)
    || (request.workerPid !== null && isAlive(request.workerPid) && identityOf(request.workerPid) === request.workerIdentity)) throw new Error('FULL_SNAPSHOT_IN_PROGRESS: 完整快照正在生成，请等待结束后重新启动。');
  finish({ leasePath, token: request.token }, 'Incomplete', { error: 'SNAPSHOT_WORKER_INTERRUPTED' });
}
export function createSnapshotHandoff(sourceRoot: string, directory: string, identity: SnapshotIdentity, parentPid: number, identityOf = processIdentity): SnapshotHandoff {
  const source = realpathSync(sourceRoot), leasePath = leaseFor(source), token = randomUUID();
  const parentIdentity = identityOf(parentPid); if (!parentIdentity) throw new Error('PROCESS_IDENTITY_UNAVAILABLE');
  const request: Request = { token, source, directory: resolve(directory), identity, parentPid, parentIdentity, workerPid: null, workerIdentity: null };
  requestSchema.parse(request); validatePaths(request, leasePath);
  mkdirSync(dirname(request.directory), { recursive: true });
  writeFileSync(leasePath, JSON.stringify(request), { flag: 'wx' });
  return { leasePath, token };
}
export function registerSnapshotWorker(handoff: SnapshotHandoff, workerPid: number, identityOf = processIdentity): void {
  const request = owned(handoff);
  const workerIdentity = identityOf(workerPid); if (!workerIdentity) throw new Error('PROCESS_IDENTITY_UNAVAILABLE');
  request.workerPid = workerPid; request.workerIdentity = workerIdentity; requestSchema.parse(request);
  const temporary = handoff.leasePath + '.' + handoff.token + '.tmp';
  writeFileSync(temporary, JSON.stringify(request)); renameSync(temporary, handoff.leasePath);
}
interface WorkerOptions {
  pid?: number; isAlive?: (pid: number) => boolean; identityOf?: (pid: number) => string | null; pause?: () => Promise<void>; timeoutMs?: number;
  snapshot?: (source: string, destination: string, identity: SnapshotIdentity, sourceIsClosed: () => boolean) => FullSnapshotManifest;
}
export async function runSnapshotHandoff(leasePath: string, options: WorkerOptions = {}): Promise<void> {
  let request = readRequest(leasePath);
  const handoff = { leasePath, token: request.token }, pid = options.pid ?? process.pid;
  const isAlive = options.isAlive ?? processAlive, started = Date.now();
  const identityOf = options.identityOf ?? processIdentity;
  const parentAlive = (): boolean => isAlive(request.parentPid) && identityOf(request.parentPid) === request.parentIdentity;
  // Main registers the PID immediately after spawn, before beginning its final exit.
  while (request.workerPid === null && isAlive(request.parentPid) && Date.now() - started < 5_000) {
    await (options.pause?.() ?? new Promise<void>(done => setTimeout(done, 100)));
    request = owned(handoff);
  }
  if (request.workerPid !== pid) throw new Error('SNAPSHOT_WORKER_MISMATCH');
  try {
    while (parentAlive()) {
      if (Date.now() - started >= (options.timeoutMs ?? 60_000)) throw new Error('SNAPSHOT_PARENT_EXIT_TIMEOUT');
      await (options.pause?.() ?? new Promise<void>(done => setTimeout(done, 100)));
    }
    const isClosed = (): boolean => { const current = owned(handoff); return current.workerPid === pid && !parentAlive(); };
    const manifest = (options.snapshot ?? createClosedSnapshot)(request.source, request.directory, request.identity, isClosed);
    if (!isClosed()) throw new Error('SOURCE_NOT_CLOSED');
    finish(handoff, 'Complete', { createdAt: manifest.createdAt, totalBytes: manifest.totalBytes });
  } catch (error) {
    finish(handoff, 'Incomplete', { error: error instanceof Error ? error.message : 'BACKUP_FAILED' });
    throw error;
  }
}
export function launchClosedSnapshotWorker(executable: string, worker: string, source: string, directory: string, identity: SnapshotIdentity): void {
  if (!existsSync(worker)) throw new Error('SNAPSHOT_WORKER_MISSING');
  const handoff = createSnapshotHandoff(source, directory, identity, process.pid);
  try {
    const env: NodeJS.ProcessEnv = { ELECTRON_RUN_AS_NODE: '1' };
    for (const name of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATH', 'APPDATA', 'LOCALAPPDATA']) if (process.env[name]) env[name] = process.env[name];
    const child = spawn(executable, [worker, handoff.leasePath], { env, detached: true, windowsHide: true, stdio: 'ignore' });
    if (!child.pid) throw new Error('SNAPSHOT_WORKER_START_FAILED');
    registerSnapshotWorker(handoff, child.pid);
    child.on('error', error => { if (existsSync(handoff.leasePath)) finish(handoff, 'Incomplete', { error: error.message }); });
    child.unref();
  } catch (error) {
    finish(handoff, 'Incomplete', { error: error instanceof Error ? error.message : 'BACKUP_FAILED' });
    throw error;
  }
}
