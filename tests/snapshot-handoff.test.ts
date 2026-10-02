import { mkdtempSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertSnapshotHandoffIdle, createSnapshotHandoff, registerSnapshotWorker, runSnapshotHandoff } from '../apps/desktop/src/main/snapshot-handoff';

const identity = { appVersion: '1.1.9', sourceCommit: 'a'.repeat(40), deliveryId: 'R1.15-G', migrations: [] };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'geo-handoff-'));
  const source = join(root, 'b01-isolated-user-data');
  mkdirSync(source);
  writeFileSync(join(source, 'locked-until-exit.txt'), 'closed synthetic fixture');
  const destination = join(root, 'geo-full-snapshots', 'snapshot-synthetic');
  const handoff = createSnapshotHandoff(source, destination, identity, 101, () => 'synthetic-start');
  registerSnapshotWorker(handoff, 202, () => 'synthetic-start');
  return { source, destination, ...handoff };
}
const complete = { format: 'GEO_CLOSED_USERDATA_V1' as const, status: 'Complete' as const, createdAt: 'synthetic', ...identity, sourceRoot: '', files: [], totalBytes: 0 };

describe('complete snapshot runs after the owning Electron process exits', () => {
  it('waits for process exit, holds the startup lease, then publishes Complete and releases only its lease', async () => {
    const f = fixture();
    let parentAlive = true, called = false, waits = 0;
    expect(() => assertSnapshotHandoffIdle(f.source, pid => pid === 101 || pid === 202, () => 'synthetic-start')).toThrow('FULL_SNAPSHOT_IN_PROGRESS');
    await runSnapshotHandoff(f.leasePath, {
      pid: 202, isAlive: pid => pid === 101 && parentAlive, identityOf: () => 'synthetic-start',
      pause: async () => { waits++; parentAlive = false; },
      snapshot: (source, destination, receivedIdentity, isClosed) => {
        called = true;
        expect(waits).toBeGreaterThan(0);
        expect(parentAlive).toBe(false);
        expect(source).toBe(f.source);
        expect(destination).toBe(f.destination);
        expect(receivedIdentity).toEqual(identity);
        expect(isClosed()).toBe(true);
        expect(() => assertSnapshotHandoffIdle(f.source, pid => pid === 202, () => 'synthetic-start')).toThrow('FULL_SNAPSHOT_IN_PROGRESS');
        return complete;
      }
    });
    expect(called).toBe(true);
    expect(JSON.parse(readFileSync(f.destination + '.status.json', 'utf8')).status).toBe('Complete');
    expect(existsSync(f.leasePath)).toBe(false);
    expect(readFileSync(join(f.source, 'locked-until-exit.txt'), 'utf8')).toBe('closed synthetic fixture');
  });

  it('retains failed snapshot material and marks Incomplete when reading a closed file fails', async () => {
    const f = fixture();
    await expect(runSnapshotHandoff(f.leasePath, { pid: 202, isAlive: () => false, snapshot: (_source, destination) => {
      mkdirSync(destination, { recursive: true });
      writeFileSync(join(destination, 'partial-evidence.txt'), 'preserve');
      throw new Error('EBUSY_SYNTHETIC');
    } })).rejects.toThrow('EBUSY_SYNTHETIC');
    expect(JSON.parse(readFileSync(f.destination + '.status.json', 'utf8'))).toMatchObject({ status: 'Incomplete', error: 'EBUSY_SYNTHETIC' });
    expect(readFileSync(join(f.destination, 'partial-evidence.txt'), 'utf8')).toBe('preserve');
    expect(existsSync(f.leasePath)).toBe(false);
  });

  it('refuses a worker with a different PID without clearing the active lease', async () => {
    const f = fixture();
    await expect(runSnapshotHandoff(f.leasePath, { pid: 999, isAlive: () => false })).rejects.toThrow('SNAPSHOT_WORKER_MISMATCH');
    expect(existsSync(f.leasePath)).toBe(true);
  });

  it('does not copy if the parent fails to exit within the bounded wait', async () => {
    const f = fixture();
    let called = false;
    await expect(runSnapshotHandoff(f.leasePath, { pid: 202, isAlive: () => true, identityOf: () => 'synthetic-start', timeoutMs: 0, snapshot: () => { called = true; return complete; } })).rejects.toThrow('SNAPSHOT_PARENT_EXIT_TIMEOUT');
    expect(called).toBe(false);
    expect(JSON.parse(readFileSync(f.destination + '.status.json', 'utf8')).status).toBe('Incomplete');
  });

  it('recovers an abandoned handoff as Incomplete while preserving partial files', () => {
    const f = fixture();
    mkdirSync(f.destination, { recursive: true });
    writeFileSync(join(f.destination, 'partial.txt'), 'preserve');
    assertSnapshotHandoffIdle(f.source, () => false);
    expect(existsSync(f.leasePath)).toBe(false);
    expect(JSON.parse(readFileSync(f.destination + '.status.json', 'utf8')).error).toBe('SNAPSHOT_WORKER_INTERRUPTED');
    expect(readFileSync(join(f.destination, 'partial.txt'), 'utf8')).toBe('preserve');
  });

  it('refuses destination overlap and a second handoff for the same data directory', () => {
    const f = fixture();
    expect(() => createSnapshotHandoff(f.source, join(f.source, 'geo-full-snapshots', 'snapshot-invalid'), identity, 101, () => 'synthetic-start')).toThrow('SNAPSHOT_HANDOFF_PATH_INVALID');
    expect(() => createSnapshotHandoff(f.source, join(f.source, '..', 'geo-full-snapshots', 'snapshot-second'), identity, 101, () => 'synthetic-start')).toThrow();
  });

  it('recovers when stored PIDs have been recycled by unrelated process instances', () => {
    const f = fixture();
    assertSnapshotHandoffIdle(f.source, () => true, () => 'different-start');
    expect(existsSync(f.leasePath)).toBe(false);
    expect(JSON.parse(readFileSync(f.destination + '.status.json', 'utf8')).status).toBe('Incomplete');
  });
});
