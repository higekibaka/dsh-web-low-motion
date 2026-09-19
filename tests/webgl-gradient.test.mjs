import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseGradient } from '../src/webgl-gradient.js';
import { createRendererPreferences, RENDERER_KEY } from '../src/renderer-preferences.js';

test('GPU accepts legacy horizontal gradients and preserves premultiplied transparency and implied stops', () => {
  const actual = parseGradient('linear-gradient(90deg, rgba(100, 50, 0, 0.5), rgb(20, 30, 40), rgb(0, 0, 255) 100%)');
  assert.deepEqual(actual.map(s => s.at), [0, .5, 1]);
  assert.deepEqual(actual[0].color, [50/255, 25/255, 0, .5]);
  for (const invalid of ['linear-gradient(45deg, rgb(0, 0, 0), rgb(255, 255, 255))',
    'linear-gradient(90deg in oklab, rgb(0,0,0), rgb(255,255,255))',
    'linear-gradient(90deg, color(display-p3 1 0 0), rgb(255,255,255))',
    'linear-gradient(90deg, rgb(0, 0, 0) 50%, rgb(255, 255, 255) 20%)',
    'linear-gradient(90deg, rgb(NaN, 0, 0), rgb(255, 255, 255))']) assert.equal(parseGradient(invalid), null);
});

test('renderer preference is independent, defaults safely, persists, and survives storage refusal', () => {
  let state={renderer:'css',warning:null},raw=null,blocked=false;const keys=[];
  const store={getSnapshot:()=>state,set:next=>{state=next}};
  const storage={getItem:key=>{keys.push(key);if(blocked)throw Error();return raw},setItem:(key,value)=>{keys.push(key);if(blocked)throw Error();raw=value}};
  const prefs=createRendererPreferences(store,()=>storage,true);
  assert.deepEqual(state,{renderer:'css',warning:null});
  prefs.setRenderer('webgl');assert.equal(raw,'webgl');prefs.restore();assert.equal(state.renderer,'webgl');
  blocked=true;prefs.setRenderer('css');assert.deepEqual(state,{renderer:'css',warning:'storage'});prefs.restore();assert.equal(state.renderer,'css');
  assert.throws(()=>prefs.setRenderer('auto'),TypeError);
  blocked=false;raw='bad';prefs.restore();assert.deepEqual(state,{renderer:'css',warning:'rendererInvalid'});
  const locked=createRendererPreferences(store,()=>storage,false);locked.setRenderer('webgl');assert.equal(raw,'bad');
  assert.ok(keys.every(key=>key===RENDERER_KEY));
});
