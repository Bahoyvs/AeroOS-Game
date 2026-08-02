import { describe, expect, it, vi } from 'vitest';
import { createEventBus } from '../src/core/events.js';

describe('event bus', () => {
  /**
   * Regression: the window manager used to keep one callback per event
   * (`handlers[event] = fn`). main.js registered 'close' to release the app's
   * RAM, then taskbar.js registered 'close' to drop the task button and
   * silently replaced it — so closing a window never told the game, the app
   * could not be reopened, and its memory leaked.
   */
  it('delivers an event to every listener, not just the last one', () => {
    const bus = createEventBus();
    const calls = [];
    bus.on('close', ({ id }) => calls.push(`a:${id}`));
    bus.on('close', ({ id }) => calls.push(`b:${id}`));

    bus.emit('close', { id: 'aerochat' });
    expect(calls).toEqual(['a:aerochat', 'b:aerochat']);
  });

  it('keeps event types isolated', () => {
    const bus = createEventBus();
    const close = vi.fn();
    bus.on('close', close);
    bus.emit('focus', { id: 'x' });
    expect(close).not.toHaveBeenCalled();
  });

  it('returns an unsubscribe from on()', () => {
    const bus = createEventBus();
    const fn = vi.fn();
    const off = bus.on('tick', fn);

    bus.emit('tick', 1);
    off();
    bus.emit('tick', 2);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('off() removes only the listener given', () => {
    const bus = createEventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.on('tick', a);
    bus.on('tick', b);

    bus.off('tick', a);
    bus.emit('tick', {});
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('registering the same function twice does not double-fire', () => {
    const bus = createEventBus();
    const fn = vi.fn();
    bus.on('tick', fn);
    bus.on('tick', fn);
    bus.emit('tick', {});
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('a throwing listener cannot stop the others', () => {
    const bus = createEventBus();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const after = vi.fn();

    bus.on('tick', () => {
      throw new Error('boom');
    });
    bus.on('tick', after);

    expect(() => bus.emit('tick', {})).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('emitting an event nobody listens to is a no-op', () => {
    expect(() => createEventBus().emit('nothing', {})).not.toThrow();
  });

  it('clear() drops every listener', () => {
    const bus = createEventBus();
    const fn = vi.fn();
    bus.on('tick', fn);
    bus.clear();
    bus.emit('tick', {});
    expect(fn).not.toHaveBeenCalled();
  });
});
