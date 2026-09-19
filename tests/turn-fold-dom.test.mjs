import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const source = await readFile(new URL('../src/turn-fold-dom.js', import.meta.url), 'utf8');
const MODULE = source + 'window.createToolFoldDOM = createToolFoldDOM;';
const PAGE = '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="stage"></div></body></html>';

/**
 * Instrumentation injected before the module: one MutationObserver spy, and a
 * read-counter on the `children` getter of elements carrying data-chat-flow
 * (the column), so a per-update column scan is observable from the outside.
 */
const SPIES = [
  "window.__moCount = 0;",
  "window.__observeCalls = [];",
  "window.__moDisconnects = 0;",
  "window.__childrenReads = 0;",
  "window.__childrenSpyOk = false;",
  "(function () {",
  "  var NativeObserver = window.MutationObserver;",
  "  window.MutationObserver = class SpyMutationObserver extends NativeObserver {",
  "    constructor(callback) { super(callback); window.__moCount += 1; }",
  "    observe(target, options) {",
  "      window.__observeCalls.push({ target: target, options: Object.assign({}, options) });",
  "      return super.observe(target, options);",
  "    }",
  "    disconnect() { window.__moDisconnects += 1; return super.disconnect(); }",
  "  };",
  "  var proto = Element.prototype;",
  "  var descriptor = null;",
  "  while (proto !== null && descriptor === null) {",
  "    descriptor = Object.getOwnPropertyDescriptor(proto, 'children');",
  "    if (descriptor === null) proto = Object.getPrototypeOf(proto);",
  "  }",
  "  if (descriptor === null || typeof descriptor.get !== 'function') return;",
  "  window.__childrenSpyOk = true;",
  "  var readChildren = descriptor.get;",
  "  Object.defineProperty(proto, 'children', {",
  "    configurable: true,",
  "    get: function () {",
  "      if (this instanceof Element && this.hasAttribute('data-chat-flow')) window.__childrenReads += 1;",
  "      return readChildren.call(this);",
  "    },",
  "  });",
  "})();",
].join('\n');

/** Host-faithful DOM builders for the verified seat > slot anchor > root path. */
const HELPERS = [
  "window.__t = {",
  "  reset: function () {",
  "    document.getElementById('stage').innerHTML = '';",
  "    window.__childrenReads = 0;",
  "    window.__reveals = 0;",
  "    window.__moCount = 0;",
  "    window.__observeCalls.length = 0;",
  "    window.__moDisconnects = 0;",
  "  },",
  "  column: function () {",
  "    var column = document.createElement('div');",
  "    column.className = 'column';",
  "    column.setAttribute('data-chat-flow', '');",
  "    document.getElementById('stage').append(column);",
  "    return column;",
  "  },",
  "  bar: function (column, turn) {",
  "    var seat = document.createElement('div');",
  "    seat.className = 'flowItem';",
  "    seat.setAttribute('data-chat-flow-key', 'tp-' + turn);",
  "    seat.setAttribute('data-chat-flow-kind', 'turn-process');",
  "    seat.setAttribute('data-chat-turn', String(turn));",
  "    var bar = document.createElement('button');",
  "    bar.setAttribute('data-dsh-turn-fold-header', '');",
  "    seat.append(bar);",
  "    column.append(seat);",
  "    return bar;",
  "  },",
  "  seat: function (column, options) {",
  "    var seat = document.createElement('div');",
  "    seat.className = 'flowItem';",
  "    seat.setAttribute('data-chat-flow-key', options.key);",
  "    seat.setAttribute('data-chat-flow-kind', options.kind || 'tool-call');",
  "    seat.setAttribute('data-chat-turn', String(options.turn));",
  "    seat.setAttribute('data-chat-anchor-key', options.key);",
  "    var anchor = document.createElement('div');",
  "    anchor.setAttribute('data-slot', 'conversation.chat.node');",
  "    anchor.style.display = 'contents';",
  "    seat.append(anchor);",
  "    column.append(seat);",
  "    var root = null;",
  "    if (options.callId !== undefined && options.callId !== null) {",
  "      root = document.createElement('div');",
  "      root.className = 'callRow';",
  "      root.setAttribute('data-chat-call-id', options.callId);",
  "      root.setAttribute('data-chat-anchor-key', 'call:' + options.callId);",
  "      var content = document.createElement('div');",
  "      content.textContent = options.text === undefined ? 'tool output' : options.text;",
  "      root.append(content);",
  "      if (options.nested !== undefined) {",
  "        var subCalls = document.createElement('div');",
  "        subCalls.className = 'subCalls';",
  "        var nested = document.createElement('div');",
  "        nested.className = 'callRow';",
  "        nested.setAttribute('data-chat-call-id', options.nested);",
  "        nested.setAttribute('data-chat-anchor-key', 'call:' + options.nested);",
  "        nested.textContent = 'nested';",
  "        subCalls.append(nested);",
  "        root.append(subCalls);",
  "      }",
  "      anchor.append(root);",
  "    }",
  "    return { seat: seat, anchor: anchor, root: root };",
  "  },",
  "  controller: function (anchor, turn) {",
  "    return window.createToolFoldDOM({ anchor: anchor, turn: turn, reveal: function () { window.__reveals += 1; } });",
  "  },",
  "  settle: function () {",
  "    return new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(resolve); }); });",
  "  },",
  "};",
].join('\n');

let browser;

before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

async function open(t) {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.route('http://folddom.test/', route => route.fulfill({ contentType: 'text/html', body: PAGE }));
  await page.goto('http://folddom.test/');
  await page.addScriptTag({ content: SPIES });
  await page.addScriptTag({ content: HELPERS });
  await page.addScriptTag({ type: 'module', content: MODULE });
  await page.waitForFunction(() => typeof window.createToolFoldDOM === 'function');
  return page;
}

test('folds only the shipped root with hidden=until-found, keeping it connected and its content', async (t) => {
  const page = await open(t);
  const state = await page.evaluate(() => {
    window.__t.reset();
    const column = window.__t.column();
    const row = window.__t.seat(column, { key: 't0', turn: 1, callId: 'c1', text: 'bash output' });
    const ctrl = window.__t.controller(window.__t.bar(column, 1), 1);
    ctrl.update({ nodes: [{ key: 't0', callId: 'c1' }], collapsed: true });
    const folded = {
      hidden: row.root.getAttribute('hidden'),
      marker: row.root.getAttribute('data-dsh-turn-fold-tool-hidden'),
      connected: row.root.isConnected,
      text: row.root.textContent,
      display: getComputedStyle(row.root).display,
      inlineDisplay: row.root.style.display,
      height: row.root.getBoundingClientRect().height,
      seatHidden: row.seat.hasAttribute('hidden'),
      anchorHidden: row.anchor.hasAttribute('hidden'),
    };
    ctrl.update({ nodes: [{ key: 't0', callId: 'c1' }], collapsed: false });
    const expanded = {
      hidden: row.root.getAttribute('hidden'),
      marker: row.root.getAttribute('data-dsh-turn-fold-tool-hidden'),
      connected: row.root.isConnected,
      text: row.root.textContent,
    };
    return { folded: folded, expanded: expanded };
  });
  assert.equal(state.folded.hidden, 'until-found');
  assert.ok(typeof state.folded.marker === 'string' && state.folded.marker.length > 0, 'the root carries this controller token');
  assert.equal(state.folded.connected, true);
  assert.equal(state.folded.text, 'bash output');
  assert.notEqual(state.folded.display, 'none', 'hiding is never display:none');
  assert.equal(state.folded.inlineDisplay, '', 'no inline display is written');
  assert.equal(state.folded.height, 0);
  assert.equal(state.folded.seatHidden, false, 'the seat hidden attribute stays with the shipped seat');
  assert.equal(state.folded.anchorHidden, false);
  assert.equal(state.expanded.hidden, null);
  assert.equal(state.expanded.marker, null);
  assert.equal(state.expanded.connected, true);
  assert.equal(state.expanded.text, 'bash output');
});

test('find-in-page reaches folded text, and beforematch reveals synchronously', async (t) => {
  const page = await open(t);
  const result = await page.evaluate(() => {
    window.__t.reset();
    const column = window.__t.column();
    const row = window.__t.seat(column, { key: 't0', turn: 1, callId: 'c1', text: 'needle-alpha output' });
    const ctrl = window.__t.controller(window.__t.bar(column, 1), 1);
    ctrl.update({ nodes: [{ key: 't0', callId: 'c1' }], collapsed: true });
    const found = typeof window.find === 'function' ? window.find('needle-alpha') : null;
    const afterFind = {
      reveals: window.__reveals,
      marker: row.root.getAttribute('data-dsh-turn-fold-tool-hidden'),
      hidden: row.root.getAttribute('hidden'),
    };
    ctrl.update({ nodes: [{ key: 't0', callId: 'c1' }], collapsed: true });
    const beforeManual = { marker: row.root.getAttribute('data-dsh-turn-fold-tool-hidden'), reveals: window.__reveals };
    row.root.dispatchEvent(new Event('beforematch'));
    const afterManual = {
      marker: row.root.getAttribute('data-dsh-turn-fold-tool-hidden'),
      hidden: row.root.getAttribute('hidden'),
      reveals: window.__reveals,
      text: row.root.textContent,
    };
    return { found: found, afterFind: afterFind, beforeManual: beforeManual, afterManual: afterManual };
  });
  assert.equal(result.found, true, 'hidden=until-found content stays searchable');
  if (result.afterFind.marker === null) {
    assert.ok(result.afterFind.reveals > 0, 'window.find reached the row through beforematch');
  }
  assert.ok(result.beforeManual.marker !== null, 'the row is folded before the manual event');
  assert.equal(result.afterManual.marker, null);
  assert.equal(result.afterManual.hidden, null);
  assert.equal(result.afterManual.reveals, result.beforeManual.reveals + 1, 'beforematch reveals synchronously');
  assert.equal(result.afterManual.text, 'needle-alpha output');
});

test('does not hide any sibling while focus is inside the Turn (whole-Turn reveal)', async (t) => {
  const page = await open(t);
  const state = await page.evaluate(() => {
    window.__t.reset();
    const column = window.__t.column();
    const a = window.__t.seat(column, { key: 't0', turn: 1, callId: 'c1', text: 'first' });
    const b = window.__t.seat(column, { key: 't1', turn: 1, callId: 'c2', text: 'second' });
    const focusable = document.createElement('button');
    b.root.append(focusable);
    focusable.focus();
    const ctrl = window.__t.controller(window.__t.bar(column, 1), 1);
    ctrl.update({ nodes: [{ key: 't0', callId: 'c1' }, { key: 't1', callId: 'c2' }], collapsed: true });
    const withFocus = {
      a: a.root.getAttribute('data-dsh-turn-fold-tool-hidden'),
      b: b.root.getAttribute('data-dsh-turn-fold-tool-hidden'),
      reveals: window.__reveals,
    };
    focusable.blur();
    ctrl.update({ nodes: [{ key: 't0', callId: 'c1' }, { key: 't1', callId: 'c2' }], collapsed: true });
    const afterBlur = {
      a: a.root.getAttribute('data-dsh-turn-fold-tool-hidden'),
      b: b.root.getAttribute('data-dsh-turn-fold-tool-hidden'),
    };
    return { withFocus: withFocus, afterBlur: afterBlur };
  });
  assert.equal(state.withFocus.a, null, 'focus conflict must not hide the sibling either');
  assert.equal(state.withFocus.b, null);
  assert.equal(state.withFocus.reveals, 1);
  assert.notEqual(state.afterBlur.a, null);
  assert.notEqual(state.afterBlur.b, null);
});

test('the same Turn in two columns is isolated', async (t) => {
  const page = await open(t);
  const state = await page.evaluate(() => {
    window.__t.reset();
    const one = window.__t.column();
    const two = window.__t.column();
    const rowOne = window.__t.seat(one, { key: 't0', turn: 1, callId: 'c1' });
    const rowTwo = window.__t.seat(two, { key: 't0', turn: 1, callId: 'c1' });
    const ctrlOne = window.__t.controller(window.__t.bar(one, 1), 1);
    const ctrlTwo = window.__t.controller(window.__t.bar(two, 1), 1);
    ctrlOne.update({ nodes: [{ key: 't0', callId: 'c1' }], collapsed: true });
    ctrlTwo.update({ nodes: [{ key: 't0', callId: 'c1' }], collapsed: true });
    const both = { one: rowOne.root.getAttribute('hidden'), two: rowTwo.root.getAttribute('hidden') };
    ctrlOne.update({ nodes: [{ key: 't0', callId: 'c1' }], collapsed: false });
    const after = { one: rowOne.root.getAttribute('hidden'), two: rowTwo.root.getAttribute('hidden') };
    return { both: both, after: after };
  });
  assert.equal(state.both.one, 'until-found');
  assert.equal(state.both.two, 'until-found');
  assert.equal(state.after.one, null);
  assert.equal(state.after.two, 'until-found');
});

test('controllers of one column share one index and one observer; the last dispose tears it down', async (t) => {
  const page = await open(t);
  const state = await page.evaluate(async () => {
    window.__t.reset();
    const column = window.__t.column();
    const first = window.__t.seat(column, { key: 'a', turn: 1, callId: 'c1' });
    const ctrlOne = window.__t.controller(window.__t.bar(column, 1), 1);
    const afterFirst = {
      reads: window.__childrenReads,
      observers: window.__moCount,
      columnObserves: window.__observeCalls.filter(call => call.target === column).length,
    };
    const second = window.__t.seat(column, { key: 'b', turn: 2, callId: 'c2' });
    await window.__t.settle();
    const ctrlTwo = window.__t.controller(window.__t.bar(column, 2), 2);
    const afterSecond = {
      reads: window.__childrenReads,
      observers: window.__moCount,
      columnObserves: window.__observeCalls.filter(call => call.target === column).length,
    };
    ctrlOne.update({ nodes: [{ key: 'a', callId: 'c1' }], collapsed: true });
    ctrlTwo.update({ nodes: [{ key: 'b', callId: 'c2' }], collapsed: true });
    const hidden = { a: first.root.getAttribute('hidden'), b: second.root.getAttribute('hidden') };
    ctrlOne.dispose();
    const afterFirstDispose = { a: first.root.getAttribute('hidden') };
    const replacement = document.createElement('div');
    replacement.setAttribute('data-chat-call-id', 'c2');
    replacement.setAttribute('data-chat-anchor-key', 'call:c2');
    second.anchor.replaceChildren(replacement);
    await window.__t.settle();
    const stillServed = replacement.getAttribute('hidden');
    ctrlTwo.dispose();
    const orphan = document.createElement('div');
    orphan.setAttribute('data-chat-call-id', 'c2');
    orphan.setAttribute('data-chat-anchor-key', 'call:c2');
    second.anchor.replaceChildren(orphan);
    await window.__t.settle();
    return {
      afterFirst: afterFirst,
      afterSecond: afterSecond,
      hidden: hidden,
      afterFirstDispose: afterFirstDispose,
      stillServed: stillServed,
      orphanHidden: orphan.getAttribute('hidden'),
    };
  });
  assert.equal(state.afterFirst.reads, 1, 'the first controller scans the column once');
  assert.equal(state.afterFirst.observers, 1);
  assert.equal(state.afterFirst.columnObserves, 1);
  assert.equal(state.afterSecond.reads, 1, 'the second controller reuses the shared index');
  assert.equal(state.afterSecond.observers, 1);
  assert.equal(state.afterSecond.columnObserves, 1, 'the second controller creates no second column observer');
  assert.equal(state.hidden.a, 'until-found');
  assert.equal(state.hidden.b, 'until-found');
  assert.equal(state.afterFirstDispose.a, null, 'disposing one controller unmarks only its own rows');
  assert.equal(state.stillServed, 'until-found', 'the shared observer keeps serving the remaining controller');
  assert.equal(state.orphanHidden, null, 'the last dispose stops all observation');
});

test('fails open on nested, wrapped, and wrong-kind rows', async (t) => {
  const page = await open(t);
  const state = await page.evaluate(() => {
    window.__t.reset();
    const column = window.__t.column();
    const nested = window.__t.seat(column, { key: 'n0', turn: 1, callId: 'parent', nested: 'sub1' });
    const wrapped = window.__t.seat(column, { key: 'w0', turn: 1, callId: 'cw' });
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-unknown-wrapper', '');
    wrapper.append(wrapped.root);
    wrapped.anchor.append(wrapper);
    const wrongKind = window.__t.seat(column, { key: 'k0', turn: 1, kind: 'assistant-step', callId: 'ck' });
    const ctrl = window.__t.controller(window.__t.bar(column, 1), 1);
    ctrl.update({
      nodes: [
        { key: 'n0', callId: 'sub1' },
        { key: 'w0', callId: 'cw' },
        { key: 'k0', callId: 'ck' },
      ],
      collapsed: true,
    });
    return {
      nested: nested.root.querySelector('[data-chat-call-id="sub1"]').getAttribute('hidden'),
      nestedMarker: nested.root.querySelector('[data-chat-call-id="sub1"]').getAttribute('data-dsh-turn-fold-tool-hidden'),
      wrapped: wrapped.root.getAttribute('hidden'),
      wrongKind: wrongKind.root.getAttribute('hidden'),
    };
  });
  assert.equal(state.nested, null);
  assert.equal(state.nestedMarker, null);
  assert.equal(state.wrapped, null, 'an unknown wrapper is never traversed');
  assert.equal(state.wrongKind, null);
});

test('fails open on a Turn or callId mismatch', async (t) => {
  const page = await open(t);
  const state = await page.evaluate(() => {
    window.__t.reset();
    const column = window.__t.column();
    const wrongTurn = window.__t.seat(column, { key: 'a', turn: 2, callId: 'c1' });
    const wrongCall = window.__t.seat(column, { key: 'b', turn: 1, callId: 'c2' });
    const right = window.__t.seat(column, { key: 'c', turn: 1, callId: 'c3' });
    const ctrl = window.__t.controller(window.__t.bar(column, 1), 1);
    ctrl.update({
      nodes: [
        { key: 'a', callId: 'c1' },
        { key: 'b', callId: 'wrong' },
        { key: 'c', callId: 'c3' },
      ],
      collapsed: true,
    });
    return {
      wrongTurn: wrongTurn.root.getAttribute('hidden'),
      wrongCall: wrongCall.root.getAttribute('hidden'),
      right: right.root.getAttribute('hidden'),
    };
  });
  assert.equal(state.wrongTurn, null);
  assert.equal(state.wrongCall, null);
  assert.equal(state.right, 'until-found');
});

test('never takes over, and never strips, a row another owner hid', async (t) => {
  const page = await open(t);
  const state = await page.evaluate(() => {
    window.__t.reset();
    const column = window.__t.column();
    const foreign = window.__t.seat(column, { key: 'f', turn: 1, callId: 'cf' });
    foreign.root.setAttribute('hidden', 'until-found');
    foreign.root.setAttribute('data-other-owner', '');
    const own = window.__t.seat(column, { key: 'o', turn: 1, callId: 'co' });
    const ctrl = window.__t.controller(window.__t.bar(column, 1), 1);
    ctrl.update({ nodes: [{ key: 'f', callId: 'cf' }, { key: 'o', callId: 'co' }], collapsed: true });
    const marked = {
      foreignMarker: foreign.root.getAttribute('data-dsh-turn-fold-tool-hidden'),
      foreignHidden: foreign.root.getAttribute('hidden'),
      foreignOwner: foreign.root.getAttribute('data-other-owner'),
      ownHidden: own.root.getAttribute('hidden'),
    };
    ctrl.dispose();
    const afterDispose = {
      foreignHidden: foreign.root.getAttribute('hidden'),
      foreignOwner: foreign.root.getAttribute('data-other-owner'),
      ownHidden: own.root.getAttribute('hidden'),
    };
    return { marked: marked, afterDispose: afterDispose };
  });
  assert.equal(state.marked.foreignMarker, null, 'a foreign hidden row is never marked');
  assert.equal(state.marked.foreignHidden, 'until-found');
  assert.equal(state.marked.foreignOwner, '');
  assert.equal(state.marked.ownHidden, 'until-found');
  assert.equal(state.afterDispose.foreignHidden, 'until-found', 'dispose must not strip foreign hidden');
  assert.equal(state.afterDispose.foreignOwner, '');
  assert.equal(state.afterDispose.ownHidden, null);
});

test('re-marks after root, slot anchor, and seat remounts', async (t) => {
  const page = await open(t);
  const state = await page.evaluate(async () => {
    window.__t.reset();
    const column = window.__t.column();
    const row = window.__t.seat(column, { key: 't0', turn: 1, callId: 'c1' });
    const ctrl = window.__t.controller(window.__t.bar(column, 1), 1);
    ctrl.update({ nodes: [{ key: 't0', callId: 'c1' }], collapsed: true });
    const first = row.root.getAttribute('hidden');

    const nextRoot = document.createElement('div');
    nextRoot.className = 'callRow';
    nextRoot.setAttribute('data-chat-call-id', 'c1');
    nextRoot.setAttribute('data-chat-anchor-key', 'call:c1');
    nextRoot.textContent = 'remounted root';
    row.root.replaceWith(nextRoot);
    await window.__t.settle();
    const afterRoot = {
      old: row.root.getAttribute('data-dsh-turn-fold-tool-hidden'),
      next: nextRoot.getAttribute('hidden'),
      text: nextRoot.textContent,
    };

    const nextAnchor = document.createElement('div');
    nextAnchor.setAttribute('data-slot', 'conversation.chat.node');
    const nextRootTwo = document.createElement('div');
    nextRootTwo.setAttribute('data-chat-call-id', 'c1');
    nextRootTwo.setAttribute('data-chat-anchor-key', 'call:c1');
    nextAnchor.append(nextRootTwo);
    row.anchor.replaceWith(nextAnchor);
    await window.__t.settle();
    const afterAnchor = nextRootTwo.getAttribute('hidden');

    const replacement = window.__t.seat(column, { key: 't0', turn: 1, callId: 'c1' });
    column.append(replacement.seat);
    row.seat.remove();
    await window.__t.settle();
    const afterSeat = {
      next: replacement.root.getAttribute('hidden'),
      old: nextRootTwo.getAttribute('data-dsh-turn-fold-tool-hidden'),
    };
    return { first: first, afterRoot: afterRoot, afterAnchor: afterAnchor, afterSeat: afterSeat };
  });
  assert.equal(state.first, 'until-found');
  assert.equal(state.afterRoot.next, 'until-found');
  assert.equal(state.afterRoot.old, null);
  assert.equal(state.afterRoot.text, 'remounted root');
  assert.equal(state.afterAnchor, 'until-found');
  assert.equal(state.afterSeat.next, 'until-found');
  assert.equal(state.afterSeat.old, null);
});

test('indexes a newly added seat incrementally without re-scanning the column', async (t) => {
  const page = await open(t);
  const state = await page.evaluate(async () => {
    window.__t.reset();
    const column = window.__t.column();
    const first = window.__t.seat(column, { key: 'a', turn: 1, callId: 'c1' });
    const ctrl = window.__t.controller(window.__t.bar(column, 1), 1);
    ctrl.update({ nodes: [{ key: 'a', callId: 'c1' }], collapsed: true });
    const readsAfterSetup = window.__childrenReads;
    const second = window.__t.seat(column, { key: 'b', turn: 1, callId: 'c2' });
    await window.__t.settle();
    const readsAfterAdd = window.__childrenReads;
    ctrl.update({ nodes: [{ key: 'a', callId: 'c1' }, { key: 'b', callId: 'c2' }], collapsed: true });
    const readsAfterUpdate = window.__childrenReads;
    return {
      readsAfterSetup: readsAfterSetup,
      readsAfterAdd: readsAfterAdd,
      readsAfterUpdate: readsAfterUpdate,
      hidden: { a: first.root.getAttribute('hidden'), b: second.root.getAttribute('hidden') },
    };
  });
  assert.equal(state.readsAfterSetup, 1);
  assert.equal(state.readsAfterAdd, 1, 'the observer indexes the new seat without reading the column children');
  assert.equal(state.readsAfterUpdate, 1, 'update resolves through the index, not a column scan');
  assert.equal(state.hidden.a, 'until-found');
  assert.equal(state.hidden.b, 'until-found');
});

test('dispose is idempotent and leaves no listener or observer', async (t) => {
  const page = await open(t);
  const state = await page.evaluate(async () => {
    window.__t.reset();
    const column = window.__t.column();
    const row = window.__t.seat(column, { key: 'a', turn: 1, callId: 'c1' });
    const ctrl = window.__t.controller(window.__t.bar(column, 1), 1);
    ctrl.update({ nodes: [{ key: 'a', callId: 'c1' }], collapsed: true });
    const before = { hidden: row.root.getAttribute('hidden'), reveals: window.__reveals };
    ctrl.dispose();
    ctrl.dispose();
    const after = {
      hidden: row.root.getAttribute('hidden'),
      marker: row.root.getAttribute('data-dsh-turn-fold-tool-hidden'),
      reveals: window.__reveals,
    };
    row.root.dispatchEvent(new Event('beforematch'));
    const revealsAfterEvent = window.__reveals;
    const replacement = document.createElement('div');
    replacement.setAttribute('data-chat-call-id', 'c1');
    replacement.setAttribute('data-chat-anchor-key', 'call:c1');
    row.anchor.replaceChildren(replacement);
    await window.__t.settle();
    return {
      before: before,
      after: after,
      revealsAfterEvent: revealsAfterEvent,
      replacementHidden: replacement.getAttribute('hidden'),
      disconnects: window.__moDisconnects,
    };
  });
  assert.equal(state.before.hidden, 'until-found');
  assert.equal(state.after.hidden, null);
  assert.equal(state.after.marker, null);
  assert.ok(state.disconnects >= 1, 'the observer is disconnected');
  assert.equal(state.revealsAfterEvent, state.after.reveals, 'no beforematch listener survives dispose');
  assert.equal(state.replacementHidden, null, 'no observation survives the last dispose');
});

test('observes only direct childList, and streaming text never re-scans or re-marks', async (t) => {
  const page = await open(t);
  const state = await page.evaluate(async () => {
    window.__t.reset();
    const column = window.__t.column();
    const row = window.__t.seat(column, { key: 'a', turn: 1, callId: 'c1', text: 'first' });
    const ctrl = window.__t.controller(window.__t.bar(column, 1), 1);
    ctrl.update({ nodes: [{ key: 'a', callId: 'c1' }], collapsed: true });
    const distinctOptions = Array.from(new Set(window.__observeCalls.map(call => Object.keys(call.options).sort().join(','))));
    const observesAfterSetup = window.__observeCalls.length;
    const readsAfterSetup = window.__childrenReads;
    const revealsAfterSetup = window.__reveals;

    row.root.firstChild.firstChild.nodeValue = 'streamed text one';
    await window.__t.settle();
    const span = document.createElement('span');
    span.textContent = 'streamed text two';
    row.root.append(span);
    await window.__t.settle();
    row.seat.setAttribute('data-noise', '1');
    row.root.setAttribute('data-noise', '2');
    await window.__t.settle();

    return {
      distinctOptions: distinctOptions,
      observesAfterSetup: observesAfterSetup,
      observesAfter: window.__observeCalls.length,
      readsAfterSetup: readsAfterSetup,
      readsAfter: window.__childrenReads,
      revealsAfterSetup: revealsAfterSetup,
      revealsAfter: window.__reveals,
      hidden: row.root.getAttribute('hidden'),
      spyOk: window.__childrenSpyOk,
    };
  });
  assert.equal(state.spyOk, true, 'the children read-counter must be installed for this test to mean anything');
  assert.deepEqual(state.distinctOptions, ['childList'], 'only direct childList options are ever used');
  assert.equal(state.observesAfter, state.observesAfterSetup, 'text or attribute churn must not add observe targets');
  assert.equal(state.readsAfter, state.readsAfterSetup, 'text or attribute churn must not re-scan the column');
  assert.equal(state.revealsAfter, state.revealsAfterSetup, 'text churn must not reveal');
  assert.equal(state.hidden, 'until-found');
});

test('rejects malformed construction input and hostile update input', async (t) => {
  const page = await open(t);
  const state = await page.evaluate(() => {
    window.__t.reset();
    const column = window.__t.column();
    const bar = window.__t.bar(column, 1);
    const detached = document.createElement('button');
    const errors = [];
    function attempt(fn) {
      try { fn(); errors.push(null); } catch (error) { errors.push(error.name); }
    }
    attempt(() => window.createToolFoldDOM({ anchor: detached, turn: 1, reveal: function () {} }));
    attempt(() => window.createToolFoldDOM({ anchor: bar, turn: -1, reveal: function () {} }));
    attempt(() => window.createToolFoldDOM({ anchor: bar, turn: 1.5, reveal: function () {} }));
    attempt(() => window.createToolFoldDOM({ anchor: bar, turn: 1, reveal: null }));
    const ctrl = window.__t.controller(bar, 1);
    const updateErrors = [];
    function attemptUpdate(fn) {
      try { fn(); updateErrors.push(null); } catch (error) { updateErrors.push(error.name); }
    }
    attemptUpdate(() => ctrl.update({ nodes: 'nope', collapsed: true }));
    attemptUpdate(() => ctrl.update({ nodes: [], collapsed: 'yes' }));
    return { errors: errors, updateErrors: updateErrors };
  });
  assert.deepEqual(state.errors, ['TypeError', 'TypeError', 'TypeError', 'TypeError']);
  assert.deepEqual(state.updateErrors, [null, 'TypeError'], 'malformed node entries fail open, a non-boolean collapsed throws');
});

test('watches an empty slot anchor so a later root insertion is folded', async (t) => {
  const page = await open(t);
  const state = await page.evaluate(async () => {
    window.__t.reset();
    const column = window.__t.column();
    const row = window.__t.seat(column, { key: 'a', turn: 1, callId: null });
    const ctrl = window.__t.controller(window.__t.bar(column, 1), 1);
    ctrl.update({ nodes: [{ key: 'a', callId: 'c1' }], collapsed: true });
    const beforeRoot = row.anchor.querySelector('[data-chat-call-id]');
    const root = document.createElement('div');
    root.setAttribute('data-chat-call-id', 'c1');
    root.setAttribute('data-chat-anchor-key', 'call:c1');
    root.textContent = 'late root';
    row.anchor.append(root);
    await window.__t.settle();
    return {
      beforeRoot: beforeRoot,
      hidden: root.getAttribute('hidden'),
      marker: root.getAttribute('data-dsh-turn-fold-tool-hidden'),
      text: root.textContent,
    };
  });
  assert.equal(state.beforeRoot, null);
  assert.equal(state.hidden, 'until-found');
  assert.ok(state.marker !== null);
  assert.equal(state.text, 'late root');
});

test('re-marks a root removed and inserted again one microtask later', async (t) => {
  const page = await open(t);
  const state = await page.evaluate(async () => {
    window.__t.reset();
    const column = window.__t.column();
    const row = window.__t.seat(column, { key: 'a', turn: 1, callId: 'c1' });
    const ctrl = window.__t.controller(window.__t.bar(column, 1), 1);
    ctrl.update({ nodes: [{ key: 'a', callId: 'c1' }], collapsed: true });
    const firstHidden = row.root.getAttribute('hidden');
    row.root.remove();
    await window.__t.settle();
    const betweenMarker = row.root.getAttribute('data-dsh-turn-fold-tool-hidden');
    const next = document.createElement('div');
    next.setAttribute('data-chat-call-id', 'c1');
    next.setAttribute('data-chat-anchor-key', 'call:c1');
    next.textContent = 'second root';
    row.anchor.append(next);
    await window.__t.settle();
    return {
      firstHidden: firstHidden,
      betweenMarker: betweenMarker,
      hidden: next.getAttribute('hidden'),
      marker: next.getAttribute('data-dsh-turn-fold-tool-hidden'),
    };
  });
  assert.equal(state.firstHidden, 'until-found');
  assert.equal(state.betweenMarker, null, 'the removed root loses our marker');
  assert.equal(state.hidden, 'until-found', 'the retained watch folds the re-inserted root');
  assert.ok(state.marker !== null);
});

test('keeps the seat index when a new seat appears in the same task as another dispose', async (t) => {
  const page = await open(t);
  const state = await page.evaluate(async () => {
    window.__t.reset();
    const column = window.__t.column();
    const rowA = window.__t.seat(column, { key: 'a', turn: 1, callId: 'c1' });
    const ctrlA = window.__t.controller(window.__t.bar(column, 1), 1);
    const ctrlB = window.__t.controller(window.__t.bar(column, 2), 2);
    ctrlA.update({ nodes: [{ key: 'a', callId: 'c1' }], collapsed: true });
    ctrlB.update({ nodes: [{ key: 'b', callId: 'c2' }], collapsed: true });
    const aHidden = rowA.root.getAttribute('hidden');
    const rowB = window.__t.seat(column, { key: 'b', turn: 2, callId: 'c2' });
    ctrlA.dispose();
    await window.__t.settle();
    return {
      aHidden: aHidden,
      aMarker: rowA.root.getAttribute('data-dsh-turn-fold-tool-hidden'),
      bHidden: rowB.root.getAttribute('hidden'),
      bMarker: rowB.root.getAttribute('data-dsh-turn-fold-tool-hidden'),
    };
  });
  assert.equal(state.aHidden, 'until-found');
  assert.equal(state.aMarker, null, 'the disposed controller unmarks its own row');
  assert.equal(state.bHidden, 'until-found', 'the same-task seat survived the rebuild and is folded');
  assert.ok(state.bMarker !== null);
});

test('an unrelated seat insertion never reads an older Turn root', async (t) => {
  const page = await open(t);
  const state = await page.evaluate(async () => {
    window.__t.reset();
    const column = window.__t.column();
    const old = window.__t.seat(column, { key: 'old', turn: 1, callId: 'c1' });
    const ctrl = window.__t.controller(window.__t.bar(column, 1), 1);
    ctrl.update({ nodes: [{ key: 'old', callId: 'c1' }], collapsed: true });
    await window.__t.settle();
    let rootReads = 0;
    const originalGet = old.root.getAttribute.bind(old.root);
    old.root.getAttribute = function (name) { rootReads += 1; return originalGet(name); };
    window.__t.seat(column, { key: 'new', turn: 2, callId: 'c2' });
    await window.__t.settle();
    const readsAfterSettle = rootReads;
    const oldHidden = old.root.getAttribute('hidden');
    return { reads: readsAfterSettle, oldHidden: oldHidden };
  });
  assert.equal(state.reads, 0, 'the older Turn root is not even inspected');
  assert.equal(state.oldHidden, 'until-found');
});

test('each controller owns a distinct marker token', async (t) => {
  const page = await open(t);
  const state = await page.evaluate(() => {
    window.__t.reset();
    const column = window.__t.column();
    const rowA = window.__t.seat(column, { key: 'a', turn: 1, callId: 'c1' });
    const rowB = window.__t.seat(column, { key: 'b', turn: 2, callId: 'c2' });
    const ctrlA = window.__t.controller(window.__t.bar(column, 1), 1);
    const ctrlB = window.__t.controller(window.__t.bar(column, 2), 2);
    ctrlA.update({ nodes: [{ key: 'a', callId: 'c1' }], collapsed: true });
    ctrlB.update({ nodes: [{ key: 'b', callId: 'c2' }], collapsed: true });
    return {
      a: rowA.root.getAttribute('data-dsh-turn-fold-tool-hidden'),
      b: rowB.root.getAttribute('data-dsh-turn-fold-tool-hidden'),
    };
  });
  assert.ok(state.a !== null && state.b !== null);
  assert.notEqual(state.a, state.b);
});

test('never overwrites or strips a marker another owner took over', async (t) => {
  const page = await open(t);
  const state = await page.evaluate(() => {
    window.__t.reset();
    const column = window.__t.column();
    const rowA = window.__t.seat(column, { key: 'a', turn: 1, callId: 'c1' });
    const rowB = window.__t.seat(column, { key: 'b', turn: 1, callId: 'c2' });
    const ctrl = window.__t.controller(window.__t.bar(column, 1), 1);
    ctrl.update({ nodes: [{ key: 'a', callId: 'c1' }], collapsed: true });
    const tokenA = rowA.root.getAttribute('data-dsh-turn-fold-tool-hidden');
    rowA.root.setAttribute('data-dsh-turn-fold-tool-hidden', 'foreign-token');
    rowA.root.setAttribute('hidden', 'other');
    ctrl.update({ nodes: [{ key: 'a', callId: 'c1' }, { key: 'b', callId: 'c2' }], collapsed: true });
    const afterTakeover = {
      aMarker: rowA.root.getAttribute('data-dsh-turn-fold-tool-hidden'),
      aHidden: rowA.root.getAttribute('hidden'),
      bMarker: rowB.root.getAttribute('data-dsh-turn-fold-tool-hidden'),
    };
    rowB.root.setAttribute('hidden', 'other-value');
    ctrl.dispose();
    const afterDispose = {
      aMarker: rowA.root.getAttribute('data-dsh-turn-fold-tool-hidden'),
      aHidden: rowA.root.getAttribute('hidden'),
      bMarker: rowB.root.getAttribute('data-dsh-turn-fold-tool-hidden'),
      bHidden: rowB.root.getAttribute('hidden'),
    };
    return { tokenA: tokenA, afterTakeover: afterTakeover, afterDispose: afterDispose };
  });
  assert.ok(typeof state.tokenA === 'string' && state.tokenA.length > 0);
  assert.equal(state.afterTakeover.aMarker, 'foreign-token', 'a foreign marker is never overwritten');
  assert.equal(state.afterTakeover.aHidden, 'other', 'a foreign hidden value is never overwritten');
  assert.ok(state.afterTakeover.bMarker !== null && state.afterTakeover.bMarker !== 'foreign-token');
  assert.equal(state.afterDispose.aMarker, 'foreign-token', 'dispose must not strip a foreign marker');
  assert.equal(state.afterDispose.aHidden, 'other');
  assert.equal(state.afterDispose.bMarker, null, 'our own marker is removed');
  assert.equal(state.afterDispose.bHidden, 'other-value', 'a hidden value another owner changed is kept');
});

test('a focus conflict stays revealed across a later structural mutation', async (t) => {
  const page = await open(t);
  const state = await page.evaluate(async () => {
    window.__t.reset();
    const column = window.__t.column();
    const row = window.__t.seat(column, { key: 'a', turn: 1, callId: 'c1' });
    const focusable = document.createElement('button');
    row.root.append(focusable);
    focusable.focus();
    const ctrl = window.__t.controller(window.__t.bar(column, 1), 1);
    ctrl.update({ nodes: [{ key: 'a', callId: 'c1' }], collapsed: true });
    const afterConflict = {
      marker: row.root.getAttribute('data-dsh-turn-fold-tool-hidden'),
      hidden: row.root.getAttribute('hidden'),
      reveals: window.__reveals,
    };
    row.seat.remove();
    column.append(row.seat);
    await window.__t.settle();
    const afterMutation = {
      marker: row.root.getAttribute('data-dsh-turn-fold-tool-hidden'),
      hidden: row.root.getAttribute('hidden'),
      reveals: window.__reveals,
    };
    return { afterConflict: afterConflict, afterMutation: afterMutation };
  });
  assert.equal(state.afterConflict.marker, null);
  assert.equal(state.afterConflict.hidden, null);
  assert.equal(state.afterConflict.reveals, 1);
  assert.equal(state.afterMutation.marker, null, 'no re-hide before the parent state returns');
  assert.equal(state.afterMutation.hidden, null);
  assert.equal(state.afterMutation.reveals, 1);
});

test('batches observer target updates for one update round', async (t) => {
  const page = await open(t);
  const state = await page.evaluate(() => {
    window.__t.reset();
    const column = window.__t.column();
    const rows = [];
    for (let index = 0; index < 20; index += 1) {
      rows.push(window.__t.seat(column, { key: 'k' + index, turn: 1, callId: 'c' + index }));
    }
    const ctrl = window.__t.controller(window.__t.bar(column, 1), 1);
    ctrl.update({
      nodes: rows.map((_, index) => ({ key: 'k' + index, callId: 'c' + index })),
      collapsed: true,
    });
    const marked = rows.filter(row => row.root.getAttribute('hidden') === 'until-found').length;
    const before = window.__moDisconnects;
    ctrl.update({ nodes: [], collapsed: false });
    const rebuilds = window.__moDisconnects - before;
    const remaining = rows.filter(row => row.root.hasAttribute('hidden')).length;
    return { marked: marked, rebuilds: rebuilds, remaining: remaining };
  });
  assert.equal(state.marked, 20);
  assert.equal(state.remaining, 0);
  assert.equal(state.rebuilds, 1, 'twenty watch releases rebuild the observation set once');
});

test('a reveal without a parent update drops key routing: remounting the same key reads no target', async (t) => {
  const page = await open(t);
  const state = await page.evaluate(async () => {
    window.__t.reset();
    const reads = { beforeSeat: 0, beforeAnchor: 0, beforeRoot: 0, focusSeat: 0, focusAnchor: 0, focusRoot: 0 };
    function spy(element, key) {
      const original = element.getAttribute.bind(element);
      element.getAttribute = function (name) {
        if (name !== 'data-chat-flow-key') reads[key] += 1;
        return original(name);
      };
    }
    const columnA = window.__t.column();
    const rowA = window.__t.seat(columnA, { key: 'a', turn: 1, callId: 'c1' });
    const ctrlA = window.__t.controller(window.__t.bar(columnA, 1), 1);
    ctrlA.update({ nodes: [{ key: 'a', callId: 'c1' }], collapsed: true });
    rowA.root.dispatchEvent(new Event('beforematch'));
    const columnB = window.__t.column();
    const rowB = window.__t.seat(columnB, { key: 'b', turn: 1, callId: 'c2' });
    const focusable = document.createElement('button');
    rowB.root.append(focusable);
    focusable.focus();
    const ctrlB = window.__t.controller(window.__t.bar(columnB, 1), 1);
    ctrlB.update({ nodes: [{ key: 'b', callId: 'c2' }], collapsed: true });
    const revealsAfterReveal = window.__reveals;
    focusable.blur();
    const rootAOriginal = rowA.root.getAttribute.bind(rowA.root);
    const rootBOriginal = rowB.root.getAttribute.bind(rowB.root);
    spy(rowA.seat, 'beforeSeat');
    spy(rowA.anchor, 'beforeAnchor');
    spy(rowA.root, 'beforeRoot');
    spy(rowB.seat, 'focusSeat');
    spy(rowB.anchor, 'focusAnchor');
    spy(rowB.root, 'focusRoot');
    rowA.seat.remove();
    columnA.append(rowA.seat);
    rowB.seat.remove();
    columnB.append(rowB.seat);
    await window.__t.settle();
    return {
      revealsAfterReveal: revealsAfterReveal,
      revealsAfterRemount: window.__reveals,
      reads: reads,
      beforeHidden: rootAOriginal('hidden'),
      beforeMarker: rootAOriginal('data-dsh-turn-fold-tool-hidden'),
      focusHidden: rootBOriginal('hidden'),
      focusMarker: rootBOriginal('data-dsh-turn-fold-tool-hidden'),
    };
  });
  assert.equal(state.revealsAfterReveal, 2, 'one reveal per controller');
  assert.equal(state.revealsAfterRemount, 2, 'neither controller runs again without a parent update');
  assert.deepEqual(state.reads, { beforeSeat: 0, beforeAnchor: 0, beforeRoot: 0, focusSeat: 0, focusAnchor: 0, focusRoot: 0 }, 'no target is read after the reveal');
  assert.equal(state.beforeHidden, null);
  assert.equal(state.beforeMarker, null);
  assert.equal(state.focusHidden, null);
  assert.equal(state.focusMarker, null);
});

test('the shipped source has no timers, rAF loop, or subtree observation', () => {
  assert.ok(!/setInterval|setTimeout|requestAnimationFrame/.test(source), 'no timers or rAF loop');
  assert.ok(!/querySelectorAll/.test(source), 'no document-wide queries');
  assert.ok(!/subtree\s*:\s*true/.test(source), 'no subtree observation option');
  assert.ok(!/\.style\.display/.test(source), 'no display writes');
});
