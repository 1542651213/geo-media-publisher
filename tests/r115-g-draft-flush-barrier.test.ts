import { describe, expect, it } from 'vitest';
import { DraftFlushBarrier } from '../apps/desktop/src/main/draft-flush-barrier';

describe('Main draft shutdown barrier', () => {
  it('accepts only matching sender and request and waits for Main persistence acknowledgement', async () => {
    const barrier = new DraftFlushBarrier(50);
    let id = '';
    const pending = barrier.request(10, value => { id = value; });
    expect(barrier.respond(11, id, true)).toBe(false);
    expect(barrier.respond(10, 'unrequested', true)).toBe(false);
    expect(barrier.respond(10, id, true)).toBe(true);
    await expect(pending).resolves.toBe(true);
    expect(barrier.respond(10, id, true)).toBe(false);
  });
  it('does not permit close after failure, timeout or unavailable renderer', async () => {
    const barrier = new DraftFlushBarrier(5);
    const failed = barrier.request(10, id => { barrier.respond(10, id, false); });
    await expect(failed).resolves.toBe(false);
    await expect(barrier.request(10, () => {})).resolves.toBe(false);
    await expect(barrier.request(10, () => { throw new Error('window unavailable'); })).resolves.toBe(false);
  });
});
