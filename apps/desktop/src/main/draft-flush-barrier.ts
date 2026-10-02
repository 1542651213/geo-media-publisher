import { randomUUID } from 'node:crypto';

/** A close request succeeds only after the requesting Renderer confirms its Main-backed saves. */
export class DraftFlushBarrier {
  private readonly pending = new Map<string, { senderId: number; finish: (success: boolean) => void }>();
  constructor(private readonly timeoutMs = 10_000) {}
  request(senderId: number, send: (requestId: string) => void): Promise<boolean> {
    const requestId = randomUUID();
    return new Promise(resolve => {
      const timer = setTimeout(() => finish(false), this.timeoutMs);
      const finish = (success: boolean): void => { clearTimeout(timer); this.pending.delete(requestId); resolve(success); };
      this.pending.set(requestId, { senderId, finish });
      try { send(requestId); } catch { finish(false); }
    });
  }
  respond(senderId: number, requestId: unknown, success: unknown): boolean {
    if (typeof requestId !== 'string' || typeof success !== 'boolean') return false;
    const request = this.pending.get(requestId);
    if (!request || request.senderId !== senderId) return false;
    request.finish(success);
    return true;
  }
}
