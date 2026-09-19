import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFrameRatePreferences, FRAME_RATE_KEY } from '../src/frame-rate.js';

function setup(raw = null, allowed = true) {
  let value = { frameRate: 0, warning: null }, stored = raw;
  const faults = { read: false, write: false }; const writes = [];
  const storage = {
    getItem(key) { assert.equal(key, FRAME_RATE_KEY); if (faults.read) throw Error('blocked'); return stored; },
    setItem(key, next) { assert.equal(key, FRAME_RATE_KEY); if (faults.write) throw Error('blocked'); stored = next; writes.push(next); },
  };
  const preference = createFrameRatePreferences({ getSnapshot: () => value, set: next => { value = next; } }, () => storage, allowed);
  return { preference, faults, writes, snapshot: () => value, stored: () => stored };
}

test('frame-rate preferences persist zero and caps independently, validate input and retain local choices on storage failure', () => {
  const state = setup(); assert.deepEqual(state.snapshot(), { frameRate: 0, warning: null }); assert.equal(state.writes.length, 0);
  for (const cap of [24, 30, 60, 120, 0]) {
    state.preference.setFrameRate(cap);
    assert.equal(setup(state.stored()).snapshot().frameRate, cap);
  }
  state.faults.write = true; state.preference.setFrameRate(60);
  assert.equal(state.snapshot().frameRate, 60); assert.equal(state.snapshot().warning, 'storage');
  state.faults.read = true; state.preference.restore(); assert.equal(state.snapshot().frameRate, 60);
  for (const bad of ['60', null, 25, -1, Infinity, NaN]) assert.throws(() => state.preference.setFrameRate(bad), TypeError);
  assert.equal(state.snapshot().frameRate, 60);
});

test('invalid storage defaults safely and profile disable preserves but cannot overwrite the saved cap', () => {
  for (const raw of ['', '25', '060', 'null']) assert.deepEqual(setup(raw).snapshot(), { frameRate: 0, warning: 'frameRateInvalid' });
  const state = setup('30', false); state.preference.setFrameRate(120);
  assert.equal(state.snapshot().frameRate, 30); assert.equal(state.stored(), '30'); assert.equal(state.writes.length, 0);
});
