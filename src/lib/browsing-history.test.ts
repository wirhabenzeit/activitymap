import assert from 'node:assert/strict';

import test from 'node:test';

import {
  closeActivityInspection,
  closeTileFocus,
  focusCloseTarget,
  openActivityInspection,
  openTileFocus,
  subscribeBrowsingHistory,
} from './browsing-history';

void test('shared history owns one subscription and preserves inspection sessions, nested Back, direct links and URL state', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const target = new EventTarget();
  let adds = 0;
  let removes = 0;
  let index = 0;
  const entries: { href: string; state: unknown }[] = [
    { href: 'https://fixture.test/list?view=all#rows', state: { __NA: true } },
  ];
  const entry = () => entries[index]!;
  const location = () => new URL(entry().href);
  const browser = {
    get location() {
      return location();
    },
    history: {
      get state() {
        return entry().state;
      },
      pushState(state: unknown, _title: string, href: string) {
        entries.splice(index + 1);
        entries.push({ state, href: new URL(href, location()).href });
        index++;
      },
      replaceState(state: unknown, _title: string, href: string) {
        entries[index] = { state, href: new URL(href, location()).href };
      },
      back() {
        if (index) {
          index--;
          target.dispatchEvent(new Event('popstate'));
        }
      },
    },
    addEventListener(name: string, listener: EventListener) {
      adds++;
      target.addEventListener(name, listener);
    },
    removeEventListener(name: string, listener: EventListener) {
      removes++;
      target.removeEventListener(name, listener);
    },
  };
  Object.defineProperty(globalThis, 'window', {
    value: browser,
    configurable: true,
  });
  let first = 0;
  let second = 0;
  const offFirst = subscribeBrowsingHistory(() => first++);
  const offSecond = subscribeBrowsingHistory(() => second++);
  try {
    assert.equal(adds, 1);
    openActivityInspection('list', 1);
    openActivityInspection('list', 2);
    assert.equal(entries.length, 2, 'Stepping replaces the inspection entry');
    assert.equal(browser.location.search, '?view=all&activity=2');
    assert.equal(browser.location.hash, '#rows');
    assert.deepEqual(browser.history.state, {
      activityListDetail: { returnTo: '/list?view=all#rows' },
    });
    closeActivityInspection('list');
    assert.equal(index, 0);
    index++;
    target.dispatchEvent(new Event('popstate'));
    assert.equal(
      browser.location.search,
      '?view=all&activity=2',
      'Forward restores the inspected identity',
    );
    assert.equal(first, second);
    browser.history.replaceState(
      null,
      '',
      '/stats?tile=records&activity=7&unit=mi#chart',
    );
    openActivityInspection('stats', 8);
    assert.equal(focusCloseTarget(), 'inspection');
    closeTileFocus();
    assert.equal(browser.location.search, '?tile=records&unit=mi');
    assert.equal(browser.location.hash, '#chart');
    assert.equal(focusCloseTarget(), 'dashboard');
    closeTileFocus();
    assert.equal(browser.location.search, '?unit=mi');
    openTileFocus('records');
    const focusIndex = index;
    openActivityInspection('stats', 12);
    openActivityInspection('stats', 13);
    assert.equal(index, focusIndex + 1);
    assert.equal(focusCloseTarget(), 'back');
    closeTileFocus();
    assert.equal(
      index,
      focusIndex,
      'Nested inspection closes before tile focus',
    );
    closeTileFocus();
    assert.equal(
      index,
      focusIndex - 1,
      'Originating dashboard entry owns Back',
    );
    browser.history.replaceState(
      { statsActivityDetail: { returnTo: 42 }, __NA: true },
      '',
      '/list?activity=14',
    );
    closeActivityInspection('list');
    assert.equal(
      browser.location.search,
      '',
      'Malformed/foreign metadata cannot navigate away',
    );
    offFirst();
    assert.equal(removes, 0);
    offSecond();
    assert.equal(removes, 1);
  } finally {
    offFirst();
    offSecond();
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
