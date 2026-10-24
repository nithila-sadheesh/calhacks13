import { describe, expect, it, vi } from 'vitest';
import { createBus } from './bus.ts';

describe('bus', () => {
  it('delivers events to subscribers of that type only', () => {
    const bus = createBus();
    const onReset = vi.fn();
    const onState = vi.fn();
    bus.on('tripReset', onReset);
    bus.on('tripState', onState);
    bus.emit('tripReset', { tripMs: 0 });
    expect(onReset).toHaveBeenCalledWith({ tripMs: 0 });
    expect(onState).not.toHaveBeenCalled();
  });

  it('stops delivering after unsubscribe', () => {
    const bus = createBus();
    const cb = vi.fn();
    const off = bus.on('tripReset', cb);
    off();
    bus.emit('tripReset', { tripMs: 0 });
    expect(cb).not.toHaveBeenCalled();
  });

  it('onAny sees every event', () => {
    const bus = createBus();
    const cb = vi.fn();
    bus.onAny(cb);
    bus.emit('tripState', { state: 'playing' });
    expect(cb).toHaveBeenCalledWith('tripState', { state: 'playing' });
  });

  it('onAny sees an event before the events its listeners emit', () => {
    const bus = createBus();
    const seen: string[] = [];
    bus.onAny((type) => seen.push(type));
    bus.on('tripState', () => bus.emit('tripReset', { tripMs: 0 }));
    bus.emit('tripState', { state: 'playing' });
    expect(seen).toEqual(['tripState', 'tripReset']);
  });
});
