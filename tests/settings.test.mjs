/** Real React settings controls against the selected DSH dependencies. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { en, zh } from '../src/locale.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SRC = join(ROOT, 'src');
const CHECKOUT = process.env.DSH_CHECKOUT;
if (!CHECKOUT) throw new Error('Set DSH_CHECKOUT to an existing, built DeepSeek Harness checkout.');
const REACT_DIR = join(CHECKOUT, 'node_modules/.pnpm/react@18.3.1/node_modules/react');
const REACT_DOM_DIR = join(CHECKOUT, 'node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom');
const REACT_NODE_PATHS = [
  join(CHECKOUT, 'node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules'),
  join(CHECKOUT, 'node_modules/.pnpm/react@18.3.1/node_modules'),
];

/** Browser entry. It imports the real sources and exposes a small test driver. */
const ENTRY = `
import { useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { createRendererPreferences } from './renderer-preferences.js';
import { createFrameRatePreferences } from './frame-rate.js';
import { SettingsPage } from './SettingsPage.jsx';
import { en, zh } from './locale.js';
import settingsCss from './settings.css';

const LOCALES = { en: en, zh: zh };

function createStore(initial) {
  let state = initial;
  const listeners = new Set();
  return {
    getSnapshot: function () { return state; },
    set: function (next) { state = next; listeners.forEach(function (listener) { listener(); }); },
    subscribe: function (listener) { listeners.add(listener); return function () { listeners.delete(listener); }; },
  };
}

function createStorage(seed, failRead, failWrite) {
  const data = new Map(Object.entries(seed || {}));
  return {
    getItem: function (key) {
      if (failRead) throw new Error('read blocked');
      return data.has(key) ? data.get(key) : null;
    },
    setItem: function (key, value) {
      if (failWrite) throw new Error('write blocked');
      data.set(key, String(value));
    },
    dump: function () { return Object.fromEntries(data); },
  };
}

/** The same shape the host renderer supplies: a selector over a stable snapshot store. */
function useSnapshot(store) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

let root = null;
let style = null;

window.__settings = {
  mount: function (options) {
    const config = options || {};
    const allowed = config.allowed === undefined ? true : config.allowed;
    const modeAllowed = config.modeAllowed === undefined ? allowed : config.modeAllowed;
    const mode = config.mode || 'optimized';
    const lang = config.lang || 'en';
    const storage = createStorage(config.seed, config.readThrows, config.writeThrows);
    const modeStore = createStore({
      preference: mode,
      mode: modeAllowed ? mode : 'native',
      allowed: modeAllowed,
      warning: config.modeWarning || null,
    });
    const rendererStore = createStore({ renderer: 'css', warning: null });
    const rendererPreference = createRendererPreferences(rendererStore, () => storage, modeAllowed);
    const useShimmerRenderer = selector => selector(useSnapshot(rendererStore));
    const frameRateStore = createStore({ frameRate: 0, warning: null });
    const frameRatePreference = createFrameRatePreferences(frameRateStore, () => storage, modeAllowed);
    const useFrameRate = selector => selector(useSnapshot(frameRateStore));
    const setModeCalls = [];
    const useLowMotion = function (selector) { return selector(useSnapshot(modeStore)); };
    const setMode = function (value) {
      setModeCalls.push(value);
      if (!modeAllowed) return;
      modeStore.set({ preference: value, mode: value, allowed: modeAllowed, warning: null });
    };
    const t = function (key) { return LOCALES[lang][key]; };
    if (!style) {
      style = document.createElement('style');
      document.head.append(style);
    }
    style.textContent = settingsCss;
    if (!root) root = createRoot(document.getElementById('root'));
    root.render(
      <SettingsPage useLowMotion={useLowMotion} setMode={setMode}
        useFrameRate={useFrameRate} setFrameRate={frameRatePreference.setFrameRate} useShimmerRenderer={useShimmerRenderer} setRenderer={rendererPreference.setRenderer} t={t} />
    );
    window.__settings.state = function () {
      return {
        mode: modeStore.getSnapshot(),
        setModeCalls: setModeCalls.slice(),
        storage: storage.dump(),
      };
    };
  },
  unmount: function () { if (root) { root.unmount(); root = null; } },
  state: function () { throw new Error('the settings test app is not mounted'); },
};
`;

const HTML = '<!doctype html><html><head><meta charset="utf-8"><style>'
  + ':root{--dsw-alias-label-primary:#111;--dsw-alias-label-secondary:#555;--dsw-alias-label-tertiary:#888;'
  + '--dsw-alias-border-l2:#ddd;--dsw-alias-bg-base:#fff;--dsw-alias-interactive-bg-hover:#eee;'
  + '--dsw-alias-state-business-primary:#2d4bd2;--dsw-alias-state-business-tertiary:#e8ecff}'
  + 'html,body{margin:0} body{padding:12px} *,*::before,*::after{box-sizing:border-box}'
  + '</style></head><body><div id="root"></div></body></html>';

let browser;
let bundle;

before(async () => {
  for (const dir of [REACT_DIR, REACT_DOM_DIR]) {
    assert.ok(existsSync(join(dir, 'package.json')), 'Missing read-only React dependency at ' + dir);
  }
  assert.equal(JSON.parse(readFileSync(join(REACT_DIR, 'package.json'), 'utf8')).version, '18.3.1');
  assert.equal(JSON.parse(readFileSync(join(REACT_DOM_DIR, 'package.json'), 'utf8')).version, '18.3.1');
  const result = await build({
    stdin: { contents: ENTRY, resolveDir: SRC, loader: 'jsx', sourcefile: 'settings-entry.jsx' },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    loader: { '.css': 'text' },
    nodePaths: REACT_NODE_PATHS,
    define: { 'process.env.NODE_ENV': '"development"' },
  });
  bundle = result.outputFiles[0].text;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
});

async function openApp(t, options = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  t.after(() => page.close());
  await page.route('http://plugin.test/', route => route.fulfill({ contentType: 'text/html', body: HTML }));
  await page.goto('http://plugin.test/');
  await page.addScriptTag({ content: bundle });
  await page.evaluate(value => window.__settings.mount(value), options);
  await page.locator('[data-low-motion-settings]').waitFor();
  return page;
}

const appState = page => page.evaluate(() => window.__settings.state());
test('frame-rate select is accessible, persists separately and restores without changing mode', async t => {
  const page = await openApp(t, { lang: 'zh' });
  const control = page.getByRole('combobox', { name: zh.frameRate });
  assert.equal(await control.inputValue(), '0');
  assert.deepEqual(await control.locator('option').evaluateAll(elements => elements.map(e => e.value)), ['0','24','30','60','120','280']);
  await control.selectOption('280');
  const after = await appState(page);
  assert.equal(after.storage['dsh-web-low-motion.frame-rate.v1'], '280');
  assert.deepEqual(after.setModeCalls, []);
  const restored = await openApp(t, { seed: after.storage });
  assert.equal(await restored.getByRole('combobox', { name: en.frameRate }).inputValue(), '280');
  const disabled = await openApp(t, { allowed: false, seed: after.storage });
  assert.equal(await disabled.getByRole('combobox', { name: en.frameRate }).isDisabled(), true);
});

test('GPU renderer control is accessible and persists without changing the frame cap or mode', async t => {
  const page = await openApp(t, { lang: 'zh' });
  const select=page.getByRole('combobox',{name:zh.renderer});
  assert.equal(await select.inputValue(),'css');await select.selectOption('webgl');
  const state=await appState(page);assert.equal(state.storage['dsh-web-low-motion.renderer.v1'],'webgl');
  assert.deepEqual(state.setModeCalls,[]);
  assert.equal(await page.getByRole('combobox',{name:zh.frameRate}).inputValue(),'0');
  const restored=await openApp(t,{seed:state.storage});assert.equal(await restored.getByRole('combobox',{name:en.renderer}).inputValue(),'webgl');
  const locked=await openApp(t,{allowed:false});assert.equal(await locked.getByRole('combobox',{name:en.renderer}).isDisabled(),true);
});

for (const [lang, words] of Object.entries({ en, zh })) {
  test(`motion settings in ${lang} contain no folding controls and keep all animation modes`, async t => {
    const page = await openApp(t, { lang });
    assert.equal(await page.getByRole('checkbox').count(), 0);
    assert.equal(await page.getByRole('radio').count(), 3);
    const native = page.getByRole('radio', { name: words.nativeLabel, exact: true });
    await native.check();
    assert.equal((await appState(page)).mode.mode, 'native');
    for (const width of [360, 768]) {
      await page.setViewportSize({ width, height: 800 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await page.getByRole('combobox', { name: words.frameRate }).isVisible(), true);
    }
  });
}
