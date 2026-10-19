import assert from 'node:assert/strict';

import test from 'node:test';

import { observeMapResize } from './map-resize';

void test('map resize follows real nonzero geometry, coalesces frames, and cancels work on detach', () => {
  const previous = {
    ResizeObserver: globalThis.ResizeObserver,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
  };
  let notify: () => void = () => undefined;
  let disconnected = false;
  let frame: FrameRequestCallback | undefined;
  let width = 500;
  let height = 300;
  let resized = 0;
  const container = {
    getBoundingClientRect: () => ({ width, height }),
  } as HTMLElement;
  class Observer {
    constructor(callback: ResizeObserverCallback) {
      notify = () => callback([], this);
    }
    observe(target: Element) {
      assert.equal(target, container);
    }
    disconnect() {
      disconnected = true;
    }
    unobserve() {
      return undefined;
    }
  }
  globalThis.ResizeObserver = Observer;
  globalThis.requestAnimationFrame = (callback) => {
    frame = callback;
    return 1;
  };
  globalThis.cancelAnimationFrame = () => {
    frame = undefined;
  };
  const flush = () => {
    const next = frame;
    frame = undefined;
    next?.(0);
  };
  try {
    const detach = observeMapResize({
      getContainer: () => container,
      resize: () => resized++,
    });
    assert.equal(resized, 1);
    notify();
    notify();
    flush();
    assert.equal(resized, 1, 'Same geometry causes no resize loop');
    width = 700;
    notify();
    notify();
    flush();
    assert.equal(resized, 2);
    width = 0;
    height = 0;
    notify();
    flush();
    assert.equal(resized, 2, 'Hidden retained maps are not resized to zero');
    width = 700;
    height = 300;
    notify();
    flush();
    assert.equal(resized, 3, 'Reappearing retained maps resize again');
    width = 600;
    notify();
    detach();
    flush();
    assert.equal(resized, 3);
    assert(disconnected);
  } finally {
    Object.assign(globalThis, previous);
  }
});
