import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFoldPreferences, FOLD_STORAGE_KEY } from '../src/fold-preferences.js';

const MODE_KEY = 'dsh-web-low-motion.mode.v2';
const LEGACY_KEY = 'dsh-web-low-motion.enabled.v1';

function snapshot(preference = true, allowed = true, warning = null) {
  return { preference, enabled: Boolean(allowed && preference), allowed, warning };
}

function setup({ raw = null, allowed = true, initial, extra = {},
  failRead = false, failWrite = false, failAccess = false } = {}) {
  let state = initial ?? snapshot(true, allowed);
  let publications = 0;
  const values = new Map(Object.entries(extra));
  if (raw !== null) values.set(FOLD_STORAGE_KEY, raw);
  const reads = [];
  const writes = [];
  const writeAttempts = [];
  const faults = { failRead, failWrite, failAccess };
  const store = {
    getSnapshot: () => state,
    set(value) { state = value; publications++; },
  };
  const storage = {
    getItem(key) {
      reads.push(key);
      if (faults.failRead) throw new Error('blocked read');
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      writeAttempts.push([key, value]);
      if (faults.failWrite) throw new Error('quota');
      values.set(key, value);
      writes.push([key, value]);
    },
  };
  const preferences = createFoldPreferences(store, () => {
    if (faults.failAccess) throw new Error('blocked storage access');
    return storage;
  }, allowed);
  return { store, preferences, values, reads, writes, writeAttempts, faults, publications: () => publications };
}

test('exports the versioned fold key and the two-method boolean API', () => {
  assert.equal(FOLD_STORAGE_KEY, 'dsh-web-low-motion.fold-completed.v1');
  assert.deepEqual(Object.keys(setup().preferences).sort(), ['restore', 'setEnabled']);
});

test('new users default to on without writing or publishing a no-op', () => {
  const { store, reads, writes, values, publications } = setup();
  assert.deepEqual(store.getSnapshot(), snapshot());
  assert.deepEqual(reads, [FOLD_STORAGE_KEY]);
  assert.equal(values.size, 0);
  assert.deepEqual(writes, []);
  assert.equal(publications(), 0);
});

test('restores stored booleans and persists selections as true/false strings', () => {
  for (const [raw, preference] of [['true', true], ['false', false]]) {
    const restored = setup({ raw });
    assert.deepEqual(restored.store.getSnapshot(), snapshot(preference));
    assert.deepEqual(restored.reads, [FOLD_STORAGE_KEY]);
    assert.deepEqual(restored.writes, []);
  }
  for (const value of [true, false]) {
    const selected = setup();
    selected.preferences.setEnabled(value);
    assert.deepEqual(selected.store.getSnapshot(), snapshot(value));
    assert.deepEqual(selected.writes, [[FOLD_STORAGE_KEY, String(value)]]);
    assert.deepEqual(setup({ raw: selected.values.get(FOLD_STORAGE_KEY) }).store.getSnapshot(), snapshot(value));
  }
});

test('corrupt stored values fall back to on with the dedicated foldInvalid warning', () => {
  for (const raw of ['', 'TRUE', 'False', '0', '1', 'yes', '"true"', '{}']) {
    const { store, preferences, values, writes } = setup({ raw });
    assert.deepEqual(store.getSnapshot(), snapshot(true, true, 'foldInvalid'));
    const before = store.getSnapshot();
    preferences.restore();
    assert.equal(store.getSnapshot(), before);
    assert.equal(values.get(FOLD_STORAGE_KEY), raw);
    assert.deepEqual(writes, []);
  }
});

test('toggling clears corrupt warnings and writes only the fold key', () => {
  const { store, preferences, values, writes } = setup({ raw: 'bad' });
  preferences.setEnabled(false);
  assert.deepEqual(store.getSnapshot(), snapshot(false, true, null));
  assert.deepEqual(writes, [[FOLD_STORAGE_KEY, 'false']]);
  assert.equal(values.get(FOLD_STORAGE_KEY), 'false');
});

test('clearing the fold key restores the on default without writing', () => {
  const { store, preferences, values, writes } = setup({ raw: 'false' });
  values.delete(FOLD_STORAGE_KEY);
  preferences.restore();
  assert.deepEqual(store.getSnapshot(), snapshot(true));
  assert.deepEqual(writes, []);
});

test('failed reads keep the current preference and report foldStorage without echo writes', () => {
  const fresh = setup({ failRead: true });
  assert.deepEqual(fresh.store.getSnapshot(), snapshot(true, true, 'foldStorage'));

  const { store, preferences, faults, writes } = setup();
  preferences.setEnabled(false);
  faults.failRead = true;
  preferences.restore();
  assert.deepEqual(store.getSnapshot(), snapshot(false, true, 'foldStorage'));
  const before = store.getSnapshot();
  preferences.restore();
  assert.equal(store.getSnapshot(), before);
  assert.deepEqual(writes, [[FOLD_STORAGE_KEY, 'false']]);
  faults.failRead = false;
  preferences.restore();
  assert.deepEqual(store.getSnapshot(), snapshot(false));
  assert.deepEqual(writes, [[FOLD_STORAGE_KEY, 'false']]);
});

test('storage accessor failures still allow local toggles and preserve them across failed restores', () => {
  const { store, preferences, faults, writes, writeAttempts } = setup({ failAccess: true });
  assert.deepEqual(store.getSnapshot(), snapshot(true, true, 'foldStorage'));
  preferences.setEnabled(false);
  assert.deepEqual(store.getSnapshot(), snapshot(false, true, 'foldStorage'));
  const before = store.getSnapshot();
  preferences.restore();
  assert.equal(store.getSnapshot(), before);
  assert.deepEqual(writeAttempts, []);
  assert.deepEqual(writes, []);
  faults.failAccess = false;
  preferences.setEnabled(false);
  assert.deepEqual(store.getSnapshot(), snapshot(false));
  assert.deepEqual(writes, [[FOLD_STORAGE_KEY, 'false']]);
});

test('failed writes apply the toggle locally, keep stored values, and recover on retry', () => {
  for (const value of [false, true]) {
    const { store, preferences, values, faults, writes, writeAttempts } = setup({ raw: 'false', failWrite: true });
    preferences.setEnabled(value);
    assert.deepEqual(store.getSnapshot(), snapshot(value, true, 'foldStorage'));
    assert.equal(values.get(FOLD_STORAGE_KEY), 'false');
    assert.deepEqual(writes, []);
    assert.deepEqual(writeAttempts, [[FOLD_STORAGE_KEY, String(value)]]);
    faults.failWrite = false;
    preferences.setEnabled(value);
    assert.deepEqual(store.getSnapshot(), snapshot(value));
    assert.deepEqual(writes, [[FOLD_STORAGE_KEY, String(value)]]);
  }
});

test('non-boolean values throw TypeError without publishing or touching storage', () => {
  const { store, preferences, writes, writeAttempts } = setup();
  const before = store.getSnapshot();
  for (const value of ['true', 'false', 'on', 0, 1, null, undefined, {}, [], () => true]) {
    assert.throws(() => preferences.setEnabled(value), TypeError);
    assert.equal(store.getSnapshot(), before);
  }
  assert.deepEqual(writes, []);
  assert.deepEqual(writeAttempts, []);
});

test('profile disable forces the effective switch off while preserving the saved preference', () => {
  for (const raw of [null, 'true', 'false', 'bad']) {
    const warning = raw === 'bad' ? 'foldInvalid' : null;
    const { store, preferences, values, writes, writeAttempts } = setup({ raw, allowed: false });
    assert.deepEqual(store.getSnapshot(), snapshot(raw === 'false' ? false : true, false, warning));
    const before = store.getSnapshot();
    for (const value of [true, false]) preferences.setEnabled(value);
    preferences.restore();
    assert.equal(store.getSnapshot(), before);
    assert.deepEqual(writes, []);
    assert.deepEqual(writeAttempts, []);
    if (raw === 'true' || raw === 'false') assert.equal(values.get(FOLD_STORAGE_KEY), raw);
  }
});

test('profile-disabled storage pushes change only preference and never the effective switch', () => {
  const { store, preferences, values, writes } = setup({ raw: 'true', allowed: false });
  values.set(FOLD_STORAGE_KEY, 'false');
  preferences.restore();
  assert.deepEqual(store.getSnapshot(), snapshot(false, false));
  values.clear();
  preferences.restore();
  assert.deepEqual(store.getSnapshot(), snapshot(true, false));
  assert.deepEqual(writes, []);
});

test('storage pushes adopt external fold changes without echo writes', () => {
  const { store, preferences, values, writes } = setup();
  for (const [raw, preference] of [['false', false], ['true', true]]) {
    values.set(FOLD_STORAGE_KEY, raw);
    preferences.restore();
    assert.deepEqual(store.getSnapshot(), snapshot(preference));
  }
  assert.deepEqual(writes, []);
});

test('identical states are not republished and stable restores preserve snapshot identity', () => {
  const { store, preferences, values, writes, publications } = setup();
  preferences.setEnabled(true);
  const published = publications();
  assert.deepEqual(writes, [[FOLD_STORAGE_KEY, 'true']]);
  preferences.setEnabled(true);
  assert.equal(publications(), published, 'the same state must not be published twice');
  const before = store.getSnapshot();
  values.set(FOLD_STORAGE_KEY, 'true');
  preferences.restore();
  assert.equal(store.getSnapshot(), before);
  assert.equal(publications(), published);
});

test('reads and writes only the fold key and leaves the motion keys untouched', () => {
  const extra = { [MODE_KEY]: 'reduced', [LEGACY_KEY]: 'true' };
  const { store, preferences, values, reads, writes } = setup({ extra });
  assert.deepEqual(store.getSnapshot(), snapshot());
  preferences.setEnabled(false);
  preferences.restore();
  assert.deepEqual(reads, [FOLD_STORAGE_KEY, FOLD_STORAGE_KEY]);
  assert.deepEqual(writes, [[FOLD_STORAGE_KEY, 'false']]);
  assert.equal(values.get(MODE_KEY), 'reduced');
  assert.equal(values.get(LEGACY_KEY), 'true');
  assert.equal(values.get(FOLD_STORAGE_KEY), 'false');
});
