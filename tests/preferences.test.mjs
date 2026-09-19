import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPreferences, MODES, STORAGE_KEY, LEGACY_STORAGE_KEY } from '../src/preferences.js';

function snapshot(preference = 'optimized', allowed = true, warning = null) {
  return { preference, mode: allowed ? preference : 'native', allowed, warning };
}

function setup({ raw = null, legacy = null, allowed = true, initial,
  failRead = false, failWrite = false, failAccess = false, failReadKey = null } = {}) {
  let state = initial ?? snapshot('optimized', allowed);
  let publications = 0;
  const values = new Map();
  if (raw !== null) values.set(STORAGE_KEY, raw);
  if (legacy !== null) values.set(LEGACY_STORAGE_KEY, legacy);
  const reads = [];
  const writes = [];
  const writeAttempts = [];
  const faults = { failRead, failWrite, failAccess, failReadKey };
  const store = {
    getSnapshot: () => state,
    set(value) { state = value; publications++; },
  };
  const storage = {
    getItem(key) {
      reads.push(key);
      if (faults.failRead || faults.failReadKey === key) throw new Error('blocked read');
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      writeAttempts.push([key, value]);
      if (faults.failWrite) throw new Error('quota');
      values.set(key, value);
      writes.push([key, value]);
    },
  };
  const preferences = createPreferences(store, () => {
    if (faults.failAccess) throw new Error('blocked storage access');
    return storage;
  }, allowed);
  return { store, preferences, values, reads, writes, writeAttempts, faults, publications: () => publications };
}

test('exports the three modes, versioned keys and mode-only preference API', () => {
  assert.deepEqual(MODES, ['native', 'optimized', 'reduced']);
  assert.equal(STORAGE_KEY, 'dsh-web-low-motion.mode.v2');
  assert.equal(LEGACY_STORAGE_KEY, 'dsh-web-low-motion.enabled.v1');
  assert.deepEqual(Object.keys(setup().preferences).sort(), ['restore', 'setMode']);
});

test('new users immediately default to optimized without writing or publishing a no-op', () => {
  const { store, reads, writes, values, publications } = setup();
  assert.deepEqual(store.getSnapshot(), snapshot());
  assert.deepEqual(reads, [STORAGE_KEY, LEGACY_STORAGE_KEY]);
  assert.equal(values.size, 0);
  assert.deepEqual(writes, []);
  assert.equal(publications(), 0);
});

test('restores each raw enum immediately and persists selections as raw enum strings', () => {
  for (const mode of MODES) {
    const restored = setup({ raw: mode });
    assert.deepEqual(restored.store.getSnapshot(), snapshot(mode));
    assert.deepEqual(restored.reads, [STORAGE_KEY]);
    assert.deepEqual(restored.writes, []);
    const selected = setup();
    selected.preferences.setMode(mode);
    assert.deepEqual(selected.store.getSnapshot(), snapshot(mode));
    assert.deepEqual(selected.writes, [[STORAGE_KEY, mode]]);
    assert.deepEqual(setup({ raw: selected.values.get(STORAGE_KEY) }).store.getSnapshot(), snapshot(mode));
  }
});

test('legacy true migrates to reduced and false to native without writing either key', () => {
  for (const [legacy, mode] of [['true', 'reduced'], ['false', 'native']]) {
    const { store, preferences, values, writes } = setup({ legacy });
    assert.deepEqual(store.getSnapshot(), snapshot(mode));
    assert.equal(values.has(STORAGE_KEY), false);
    assert.equal(values.get(LEGACY_STORAGE_KEY), legacy);
    preferences.restore();
    assert.deepEqual(writes, []);
    preferences.setMode('optimized');
    assert.deepEqual(writes, [[STORAGE_KEY, 'optimized']]);
    assert.equal(values.get(LEGACY_STORAGE_KEY), legacy);
  }
});

test('a present valid new key wins over every legacy value and avoids legacy reads', () => {
  for (const raw of MODES) {
    for (const legacy of ['true', 'false', 'invalid', null]) {
      const { store, reads, writes } = setup({ raw, legacy, failReadKey: LEGACY_STORAGE_KEY });
      assert.deepEqual(store.getSnapshot(), snapshot(raw));
      assert.deepEqual(reads, [STORAGE_KEY]);
      assert.deepEqual(writes, []);
    }
  }
});

test('clearing the new key restores legacy fallback; clearing all keys restores optimized', () => {
  for (const [legacy, mode] of [['true', 'reduced'], ['false', 'native']]) {
    const { store, preferences, values, writes } = setup({ raw: 'optimized', legacy });
    values.delete(STORAGE_KEY);
    preferences.restore();
    assert.deepEqual(store.getSnapshot(), snapshot(mode));
    values.clear();
    preferences.restore();
    assert.deepEqual(store.getSnapshot(), snapshot());
    const before = store.getSnapshot();
    preferences.restore();
    assert.equal(store.getSnapshot(), before);
    assert.deepEqual(writes, []);
  }
});

test('legacy storage changes cannot override a present new key', () => {
  const { store, preferences, values, writes } = setup({ raw: 'reduced', legacy: 'true' });
  const before = store.getSnapshot();
  values.set(LEGACY_STORAGE_KEY, 'false');
  preferences.restore();
  assert.equal(store.getSnapshot(), before);
  values.delete(LEGACY_STORAGE_KEY);
  preferences.restore();
  assert.equal(store.getSnapshot(), before);
  assert.deepEqual(writes, []);
});

test('invalid new values retain the invalid warning, take precedence, and are not repaired on restore', () => {
  for (const raw of ['', 'true', 'false', '"reduced"', 'unknown', 'OPTIMIZED', ' optimized ', '{}']) {
    const { store, preferences, values, reads, writes } = setup({ raw, legacy: 'false' });
    assert.deepEqual(store.getSnapshot(), snapshot('optimized', true, 'invalid'));
    assert.deepEqual(reads, [STORAGE_KEY]);
    const before = store.getSnapshot();
    preferences.restore();
    assert.equal(store.getSnapshot(), before);
    assert.equal(values.get(STORAGE_KEY), raw);
    assert.equal(values.get(LEGACY_STORAGE_KEY), 'false');
    assert.deepEqual(writes, []);
  }
});

test('invalid legacy values retain an invalid warning without modifying legacy storage', () => {
  for (const legacy of ['', 'TRUE', '0', 'optimized', '{}']) {
    const { store, preferences, values, writes } = setup({ legacy });
    assert.deepEqual(store.getSnapshot(), snapshot('optimized', true, 'invalid'));
    const before = store.getSnapshot();
    preferences.restore();
    assert.equal(store.getSnapshot(), before);
    assert.equal(values.get(LEGACY_STORAGE_KEY), legacy);
    assert.equal(values.has(STORAGE_KEY), false);
    assert.deepEqual(writes, []);
  }
});

test('selecting even the default clears invalid warnings and writes only the new key', () => {
  for (const options of [{ raw: 'bad', legacy: 'false' }, { legacy: 'bad' }]) {
    const { store, preferences, values, writes } = setup(options);
    preferences.setMode('optimized');
    assert.deepEqual(store.getSnapshot(), snapshot());
    assert.deepEqual(writes, [[STORAGE_KEY, 'optimized']]);
    assert.equal(values.get(LEGACY_STORAGE_KEY), options.legacy);
  }
});

test('failed new-key and legacy reads report storage failures without echo writes', () => {
  for (const failReadKey of [STORAGE_KEY, LEGACY_STORAGE_KEY]) {
    const { store, preferences, writes } = setup({ failReadKey });
    assert.deepEqual(store.getSnapshot(), snapshot('optimized', true, 'storage'));
    const before = store.getSnapshot();
    preferences.restore();
    assert.equal(store.getSnapshot(), before);
    assert.deepEqual(writes, []);
  }
});

test('failed reads preserve the current live selection and warning snapshots remain stable', () => {
  const { store, preferences, faults, writes } = setup();
  preferences.setMode('reduced');
  faults.failRead = true;
  preferences.restore();
  assert.deepEqual(store.getSnapshot(), snapshot('reduced', true, 'storage'));
  const before = store.getSnapshot();
  preferences.restore();
  assert.equal(store.getSnapshot(), before);
  assert.deepEqual(writes, [[STORAGE_KEY, 'reduced']]);
  faults.failRead = false;
  preferences.restore();
  assert.deepEqual(store.getSnapshot(), snapshot('reduced'));
  assert.deepEqual(writes, [[STORAGE_KEY, 'reduced']]);
});

test('storage accessor failures still allow local changes and preserve them on failed restores', () => {
  const { store, preferences, faults, writes, writeAttempts } = setup({ failAccess: true });
  assert.deepEqual(store.getSnapshot(), snapshot('optimized', true, 'storage'));
  preferences.setMode('native');
  assert.deepEqual(store.getSnapshot(), snapshot('native', true, 'storage'));
  const before = store.getSnapshot();
  preferences.restore();
  assert.equal(store.getSnapshot(), before);
  assert.deepEqual(writeAttempts, []);
  assert.deepEqual(writes, []);
  faults.failAccess = false;
  preferences.setMode('native');
  assert.deepEqual(store.getSnapshot(), snapshot('native'));
  assert.deepEqual(writes, [[STORAGE_KEY, 'native']]);
});

test('failed writes apply each mode locally, preserve stored values, and recover on retry', () => {
  for (const mode of MODES) {
    const { store, preferences, values, faults, writes, writeAttempts } = setup({
      raw: 'reduced', legacy: 'true', failWrite: true,
    });
    preferences.setMode(mode);
    assert.deepEqual(store.getSnapshot(), snapshot(mode, true, 'storage'));
    assert.equal(values.get(STORAGE_KEY), 'reduced');
    assert.equal(values.get(LEGACY_STORAGE_KEY), 'true');
    assert.deepEqual(writes, []);
    assert.deepEqual(writeAttempts, [[STORAGE_KEY, mode]]);
    faults.failWrite = false;
    preferences.setMode(mode);
    assert.deepEqual(store.getSnapshot(), snapshot(mode));
    assert.deepEqual(writes, [[STORAGE_KEY, mode]]);
    assert.equal(values.get(LEGACY_STORAGE_KEY), 'true');
  }
});

test('invalid requested modes throw without publishing or touching storage', () => {
  const { store, preferences, writes, writeAttempts } = setup();
  const before = store.getSnapshot();
  for (const value of [true, false, null, undefined, 0, '', 'true', 'fast', 'OPTIMIZED', {}, ['native']]) {
    assert.throws(() => preferences.setMode(value), TypeError);
    assert.equal(store.getSnapshot(), before);
  }
  assert.deepEqual(writes, []);
  assert.deepEqual(writeAttempts, []);
});

test('profile disable hard-forces native while preserving requested and stored preferences', () => {
  for (const raw of MODES) {
    const { store, preferences, values, writes, writeAttempts } = setup({ raw, legacy: 'true', allowed: false });
    assert.deepEqual(store.getSnapshot(), snapshot(raw, false));
    const before = store.getSnapshot();
    for (const mode of MODES) preferences.setMode(mode);
    preferences.restore();
    assert.equal(store.getSnapshot(), before);
    assert.equal(values.get(STORAGE_KEY), raw);
    assert.equal(values.get(LEGACY_STORAGE_KEY), 'true');
    assert.deepEqual(writes, []);
    assert.deepEqual(writeAttempts, []);
  }
});

test('profile disable preserves migrations and warning states while still forcing native', () => {
  for (const [options, preference, warning] of [
    [{ legacy: 'true' }, 'reduced', null],
    [{ legacy: 'false' }, 'native', null],
    [{}, 'optimized', null],
    [{ raw: 'bad' }, 'optimized', 'invalid'],
    [{ legacy: 'bad' }, 'optimized', 'invalid'],
    [{ failRead: true }, 'optimized', 'storage'],
  ]) {
    const { store, preferences, writes } = setup({ ...options, allowed: false });
    assert.deepEqual(store.getSnapshot(), snapshot(preference, false, warning));
    const before = store.getSnapshot();
    preferences.setMode('reduced');
    assert.equal(store.getSnapshot(), before);
    assert.deepEqual(writes, []);
  }
});

test('profile-disabled storage updates change only preference and never the effective native mode', () => {
  const { store, preferences, values, writes } = setup({ raw: 'reduced', allowed: false });
  values.set(STORAGE_KEY, 'optimized');
  preferences.restore();
  assert.deepEqual(store.getSnapshot(), snapshot('optimized', false));
  values.clear();
  preferences.restore();
  assert.deepEqual(store.getSnapshot(), snapshot('optimized', false));
  assert.deepEqual(writes, []);
});

test('restore corrects a stale effective mode even when preference and other fields match', () => {
  const { store, publications } = setup({
    allowed: false, initial: { preference: 'optimized', mode: 'optimized', allowed: false, warning: null },
  });
  assert.deepEqual(store.getSnapshot(), snapshot('optimized', false));
  assert.equal(publications(), 1);
});

test('storage pushes adopt without echo writes and unchanged restores preserve snapshot identity', () => {
  const { store, preferences, values, writes, publications } = setup();
  for (const mode of ['native', 'reduced', 'optimized']) {
    values.set(STORAGE_KEY, mode);
    preferences.restore();
    assert.deepEqual(store.getSnapshot(), snapshot(mode));
    const before = store.getSnapshot();
    const published = publications();
    preferences.restore();
    assert.equal(store.getSnapshot(), before);
    assert.equal(publications(), published);
  }
  assert.deepEqual(writes, []);
});
