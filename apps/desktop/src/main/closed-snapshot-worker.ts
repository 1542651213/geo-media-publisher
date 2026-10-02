import { runSnapshotHandoff } from './snapshot-handoff';

// A Node-mode child of the installed Electron executable. It opens no window,
// starts no Scheduler, reads no plaintext credentials and has no network call path.
void runSnapshotHandoff(process.argv[2] ?? '').catch(() => { process.exitCode = 1; });
