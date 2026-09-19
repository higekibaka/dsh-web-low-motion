/**
 * Independent settings-UI test for the automatic "fold completed turns" switch.
 *
 * Scope: this file renders the real SettingsPage component (transpiled in memory
 * from src/SettingsPage.jsx, src/locale.js and src/settings.css) inside a real
 * React 18.3.1 + ReactDOM 18.3.1 browser page. It exercises the component only
 * through its documented prop contract; it does NOT cover full DSH host or slot
 * integration, which is verified separately.
 *
 * React/ReactDOM are read only from an existing DSH checkout
 * (set DSH_CHECKOUT to a built checkout). Nothing is
 * installed, and no files outside this repository are written.
 */
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
const FOLD_KEY = 'dsh-web-low-motion.fold-completed.v1';
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
import { createFoldPreferences } from './fold-preferences.js';
import { en, zh } from './locale.js';
import settingsCss from './settings.css';

const LOCALES = { en: en, zh: zh };
const FOLD_KEY = 'dsh-web-low-motion.fold-completed.v1';

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

window.__fold = {
  mount: function (options) {
    const config = options || {};
    const allowed = config.allowed === undefined ? true : config.allowed;
    const modeAllowed = config.modeAllowed === undefined ? allowed : config.modeAllowed;
    const mode = config.mode || 'optimized';
    const lang = config.lang || 'en';
    const storage = createStorage(config.seed, config.foldReadThrows, config.foldWriteThrows);
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
    const foldStore = createStore({ preference: true, enabled: allowed, allowed: allowed, warning: null });
    const foldPreference = createFoldPreferences(foldStore, function () { return storage; }, allowed);
    const setModeCalls = [];
    const setFoldCalls = [];
    const useLowMotion = function (selector) { return selector(useSnapshot(modeStore)); };
    const useTurnFold = function (selector) { return selector(useSnapshot(foldStore)); };
    const setMode = function (value) {
      setModeCalls.push(value);
      if (!modeAllowed) return;
      modeStore.set({ preference: value, mode: value, allowed: modeAllowed, warning: null });
    };
    const setFoldEnabled = function (value) {
      setFoldCalls.push(value);
      foldPreference.setEnabled(value);
    };
    const t = function (key) { return LOCALES[lang][key]; };
    if (!style) {
      style = document.createElement('style');
      document.head.append(style);
    }
    style.textContent = settingsCss;
    if (!root) root = createRoot(document.getElementById('root'));
    root.render(
      <SettingsPage useLowMotion={useLowMotion} setMode={setMode} useTurnFold={useTurnFold}
        setFoldEnabled={setFoldEnabled} useFrameRate={useFrameRate} setFrameRate={frameRatePreference.setFrameRate} useShimmerRenderer={useShimmerRenderer} setRenderer={rendererPreference.setRenderer} t={t} />
    );
    window.__fold.state = function () {
      return {
        fold: foldStore.getSnapshot(),
        mode: modeStore.getSnapshot(),
        setModeCalls: setModeCalls.slice(),
        setFoldCalls: setFoldCalls.slice(),
        storage: storage.dump(),
      };
    };
  },
  unmount: function () { if (root) { root.unmount(); root = null; } },
  state: function () { throw new Error('the fold settings test app is not mounted'); },
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
    stdin: { contents: ENTRY, resolveDir: SRC, loader: 'jsx', sourcefile: 'fold-settings-entry.jsx' },
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
  await page.evaluate(value => window.__fold.mount(value), options);
  await page.locator('.dsh-lm-fold').waitFor();
  return page;
}

const appState = page => page.evaluate(() => window.__fold.state());
const foldBadge = page => page.locator('.dsh-lm-fold .dsh-lm-badge');
const modeBadge = page => page.locator('.dsh-lm-card:not(.dsh-lm-fold) .dsh-lm-badge');
const checkbox = page => page.locator('.dsh-lm-checkbox');

test('the read-only React 18.3.1 test dependencies are available in the checkout', () => {
  assert.equal(JSON.parse(readFileSync(join(REACT_DIR, 'package.json'), 'utf8')).version, '18.3.1');
  assert.equal(JSON.parse(readFileSync(join(REACT_DOM_DIR, 'package.json'), 'utf8')).version, '18.3.1');
  for (const dir of REACT_NODE_PATHS) assert.ok(existsSync(dir), dir + ' must exist');
});

test('new users see the fold switch on by default, without a stored write', async t => {
  const page = await openApp(t);
  const box = checkbox(page);
  assert.equal(await box.isChecked(), true);
  assert.equal(await box.isDisabled(), false);
  assert.equal(await foldBadge(page).textContent(), en.foldOnLabel);
  assert.equal((await page.locator('.dsh-lm-fold .dsh-lm-status').textContent()).includes(en.foldOnActive), true);
  const state = await appState(page);
  assert.deepEqual(state.fold, { preference: true, enabled: true, allowed: true, warning: null });
  assert.deepEqual(state.storage, {}, 'the default preference must not be written');
  assert.equal(await page.getByRole('checkbox', { name: en.foldLabel }).count(), 1);
  const wiring = await page.evaluate(() => {
    const input = document.querySelector('.dsh-lm-checkbox');
    const described = input.getAttribute('aria-describedby');
    const target = described && document.getElementById(described);
    return {
      labelFor: document.querySelector('.dsh-lm-fold-title').htmlFor === input.id,
      describedBy: Boolean(target) && target.textContent === document.querySelector('.dsh-lm-fold-description').textContent,
      hasLabelText: document.querySelector('.dsh-lm-fold-title').textContent.length > 0,
    };
  });
  assert.deepEqual(wiring, { labelFor: true, describedBy: true, hasLabelText: true });
});

test('switching animation modes, including Native, never changes the fold switch', async t => {
  const page = await openApp(t);
  const before = await appState(page);
  await page.locator('input.dsh-lm-radio[value="native"]').check();
  await page.waitForFunction(text => document.querySelector('.dsh-lm-card:not(.dsh-lm-fold) .dsh-lm-badge').textContent === text, en.nativeLabel);
  const after = await appState(page);
  assert.deepEqual(after.fold, before.fold);
  assert.deepEqual(after.setFoldCalls, []);
  assert.deepEqual(after.setModeCalls, ['native']);
  assert.equal(await checkbox(page).isChecked(), true);
  assert.equal(await checkbox(page).isDisabled(), false);
  assert.equal(await foldBadge(page).textContent(), en.foldOnLabel);
  assert.deepEqual(after.mode, { preference: 'native', mode: 'native', allowed: true, warning: null });
});

test('Space toggles the checkbox, updates the status, and leaves the mode untouched', async t => {
  const page = await openApp(t);
  const box = checkbox(page);
  await box.focus();
  await page.keyboard.press('Space');
  await page.waitForFunction(text => document.querySelector('.dsh-lm-fold .dsh-lm-badge').textContent === text, en.foldOffLabel);
  assert.equal(await box.isChecked(), false);
  let state = await appState(page);
  assert.deepEqual(state.fold, { preference: false, enabled: false, allowed: true, warning: null });
  assert.equal(state.storage[FOLD_KEY], 'false');
  assert.deepEqual(state.setFoldCalls, [false]);
  assert.deepEqual(state.setModeCalls, []);
  assert.equal(await modeBadge(page).textContent(), en.optimizedLabel);

  await page.keyboard.press('Space');
  await page.waitForFunction(text => document.querySelector('.dsh-lm-fold .dsh-lm-badge').textContent === text, en.foldOnLabel);
  assert.equal(await box.isChecked(), true);
  state = await appState(page);
  assert.equal(state.storage[FOLD_KEY], 'true');
  assert.deepEqual(state.setModeCalls, []);
});

test('corrupt saved data warns through the dedicated foldInvalid alert and the toggle repairs it', async t => {
  const page = await openApp(t, { seed: { [FOLD_KEY]: 'not-a-boolean' } });
  let state = await appState(page);
  assert.deepEqual(state.fold, { preference: true, enabled: true, allowed: true, warning: 'foldInvalid' });
  assert.equal(await page.locator('.dsh-lm-fold [role="alert"]').textContent(), en.foldInvalid);
  assert.equal(await foldBadge(page).textContent(), en.foldOnLabel);
  await checkbox(page).click();
  await page.waitForFunction(() => !document.querySelector('.dsh-lm-fold [role="alert"]'));
  state = await appState(page);
  assert.deepEqual(state.fold, { preference: false, enabled: false, allowed: true, warning: null });
  assert.equal(state.storage[FOLD_KEY], 'false');
});

test('unavailable storage reports foldStorage while the toggle still applies locally', async t => {
  const page = await openApp(t, { foldReadThrows: true, foldWriteThrows: true });
  let state = await appState(page);
  assert.deepEqual(state.fold, { preference: true, enabled: true, allowed: true, warning: 'foldStorage' });
  assert.equal(await page.locator('.dsh-lm-fold [role="alert"]').textContent(), en.foldStorage);
  await checkbox(page).click();
  await page.waitForFunction(text => document.querySelector('.dsh-lm-fold .dsh-lm-badge').textContent === text, en.foldOffLabel);
  state = await appState(page);
  assert.deepEqual(state.fold, { preference: false, enabled: false, allowed: true, warning: 'foldStorage' });
  assert.deepEqual(state.storage, {});
  assert.equal(await page.locator('.dsh-lm-fold [role="alert"]').textContent(), en.foldStorage);
});

test('a disabled profile keeps the saved preference while disabling the switch', async t => {
  const page = await openApp(t, { allowed: false, seed: { [FOLD_KEY]: 'false' } });
  const box = checkbox(page);
  assert.equal(await box.isChecked(), false);
  assert.equal(await box.isDisabled(), true);
  const state = await appState(page);
  assert.deepEqual(state.fold, { preference: false, enabled: false, allowed: false, warning: null });
  assert.equal(state.storage[FOLD_KEY], 'false', 'a disabled profile must not overwrite the stored preference');
  assert.equal(await foldBadge(page).textContent(), en.foldOffLabel);
  const disabledGroup = await page.evaluate(() => ({
    fieldset: document.querySelector('fieldset.dsh-lm-control').hasAttribute('disabled'),
    radio: document.querySelector('input.dsh-lm-radio').disabled,
  }));
  assert.deepEqual(disabledGroup, { fieldset: true, radio: true });
  assert.equal(await modeBadge(page).textContent(), en.nativeLabel);
  const locked = page.locator('p.dsh-lm-notice[id$="-locked"]');
  assert.equal(await locked.count(), 1);
  assert.equal(await locked.textContent(), en.locked);
  assert.equal((await box.getAttribute('aria-describedby')).endsWith('-locked'), true);

  const defaulted = await openApp(t, { allowed: false });
  assert.equal(await checkbox(defaulted).isChecked(), true, 'the default preference is still displayed when disabled');
  assert.equal(await checkbox(defaulted).isDisabled(), true);
  const defaultState = await appState(defaulted);
  assert.deepEqual(defaultState.fold, { preference: true, enabled: false, allowed: false, warning: null });
  assert.deepEqual(defaultState.storage, {});
});

test('English and Chinese labels, descriptions and warning aria are wired for assistive tech', async t => {
  const enPage = await openApp(t, { seed: { [FOLD_KEY]: 'bad' } });
  assert.equal(await enPage.locator('h2').textContent(), en.title);
  assert.equal(await enPage.locator('.dsh-lm-fold-title').textContent(), en.foldLabel);
  assert.equal(await enPage.locator('.dsh-lm-fold-description').textContent(), en.foldDescription);
  assert.equal(await enPage.locator('.dsh-lm-fold [role="status"]').getAttribute('aria-live'), 'polite');
  assert.equal(await enPage.locator('.dsh-lm-fold [role="status"]').getAttribute('aria-atomic'), 'true');
  assert.equal(await enPage.getByRole('checkbox', { name: en.foldLabel }).count(), 1);
  assert.equal(await enPage.locator('.dsh-lm-fold [role="alert"]').textContent(), en.foldInvalid);

  const zhPage = await openApp(t, { lang: 'zh', seed: { [FOLD_KEY]: 'bad' } });
  assert.equal(await zhPage.locator('.dsh-lm-fold-title').textContent(), zh.foldLabel);
  assert.equal(await zhPage.locator('.dsh-lm-fold-description').textContent(), zh.foldDescription);
  assert.equal(await zhPage.getByRole('checkbox', { name: zh.foldLabel }).count(), 1);
  assert.equal(await zhPage.locator('.dsh-lm-fold [role="alert"]').textContent(), zh.foldInvalid);
  assert.equal(await zhPage.locator('.dsh-lm-fold .dsh-lm-badge').textContent(), zh.foldOnLabel);
});

test('the settings section has no horizontal overflow at narrow and wide widths', async t => {
  const page = await openApp(t, { lang: 'zh' });
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    const metrics = await page.evaluate(() => {
      const card = document.querySelector('.dsh-lm-fold').getBoundingClientRect();
      const section = document.querySelector('.dsh-lm-page').getBoundingClientRect();
      return {
        inner: window.innerWidth,
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
        cardRight: card.right,
        sectionLeft: section.left,
        sectionRight: section.right,
      };
    });
    assert.ok(metrics.document <= metrics.inner + 1, 'document overflow at ' + width + ': ' + JSON.stringify(metrics));
    assert.ok(metrics.body <= metrics.inner + 1, 'body overflow at ' + width + ': ' + JSON.stringify(metrics));
    assert.ok(metrics.cardRight <= metrics.inner + 1, 'fold card overflow at ' + width + ': ' + JSON.stringify(metrics));
    assert.ok(metrics.sectionLeft >= 0 && metrics.sectionRight <= metrics.inner + 1, 'section overflow at ' + width + ': ' + JSON.stringify(metrics));
    assert.equal(await checkbox(page).isVisible(), true);
    assert.equal(await page.locator('.dsh-lm-fold-title').isVisible(), true);
  }
});

test('frame-rate select is accessible, persists separately and restores without changing mode or folding', async t => {
  const page = await openApp(t, { lang: 'zh' });
  const control = page.getByRole('combobox', { name: zh.frameRate });
  assert.equal(await control.inputValue(), '0');
  assert.deepEqual(await control.locator('option').evaluateAll(elements => elements.map(e => e.value)), ['0','24','30','60','120']);
  await control.selectOption('60');
  const after = await appState(page);
  assert.equal(after.storage['dsh-web-low-motion.frame-rate.v1'], '60');
  assert.deepEqual(after.setModeCalls, []); assert.deepEqual(after.setFoldCalls, []);
  const restored = await openApp(t, { seed: after.storage });
  assert.equal(await restored.getByRole('combobox', { name: en.frameRate }).inputValue(), '60');
  const disabled = await openApp(t, { allowed: false, seed: after.storage });
  assert.equal(await disabled.getByRole('combobox', { name: en.frameRate }).isDisabled(), true);
});

test('GPU renderer control is accessible and persists without changing the frame cap, folding or mode', async t => {
  const page = await openApp(t, { lang: 'zh' });
  const select=page.getByRole('combobox',{name:zh.renderer});
  assert.equal(await select.inputValue(),'css');await select.selectOption('webgl');
  const state=await appState(page);assert.equal(state.storage['dsh-web-low-motion.renderer.v1'],'webgl');
  assert.deepEqual(state.setModeCalls,[]);assert.deepEqual(state.setFoldCalls,[]);
  assert.equal(await page.getByRole('combobox',{name:zh.frameRate}).inputValue(),'0');
  const restored=await openApp(t,{seed:state.storage});assert.equal(await restored.getByRole('combobox',{name:en.renderer}).inputValue(),'webgl');
  const locked=await openApp(t,{allowed:false});assert.equal(await locked.getByRole('combobox',{name:en.renderer}).isDisabled(),true);
});
