import { createSnapshotStore } from '@deepseek-ai/dsh-client-store';
import { enabled } from './config.js';
import { createPreferences, STORAGE_KEY, LEGACY_STORAGE_KEY } from './preferences.js';
import { createRendererPreferences, RENDERER_KEY } from './renderer-preferences.js';
import { createFrameRatePreferences, FRAME_RATE_KEY } from './frame-rate.js';
import { createFoldPreferences, FOLD_STORAGE_KEY } from './fold-preferences.js';
import { mountOptimized } from './optimized.js';
import { SettingsPage } from './SettingsPage.jsx';
import { NS, en, zh } from './locale.js';
import { createTurnFoldStore, turnFoldDefinition } from './turn-fold-core.js';
import { registerTurnFold } from './turn-fold-view.jsx';
import { TURN_FOLD_NAMESPACE, en as foldEn, zh as foldZh } from './turn-fold-locale.js';
import css from './low-motion.css';
import settingsCss from './settings.css';
import turnFoldCss from './turn-fold.css';

export const name = 'web-low-motion';
export const inject = ['slots', 'locale'];

/** Register the settings page, the disposable motion policy, and the Turn fold. */
export function apply(ctx, config) {
  const allowed = enabled(config);
  const state = createSnapshotStore({ preference: 'optimized', mode: allowed ? 'optimized' : 'native', allowed, warning: null });
  const preference = createPreferences(state, () => window.localStorage, allowed);
  const rendererState = createSnapshotStore({ renderer: 'css', warning: null });
  const rendererPreference = createRendererPreferences(rendererState, () => window.localStorage, allowed);
  const frameRateState = createSnapshotStore({ frameRate: 0, warning: null });
  const frameRatePreference = createFrameRatePreferences(frameRateState, () => window.localStorage, allowed);
  const foldState = createSnapshotStore({ preference: true, enabled: allowed, allowed, warning: null });
  const foldPreference = createFoldPreferences(foldState, () => window.localStorage, allowed);
  const foldStore = createTurnFoldStore();
  ctx.effect(() => ctx.locale.register(NS, { en, zh }));
  ctx.effect(() => ctx.locale.register(TURN_FOLD_NAMESPACE, { en: foldEn, zh: foldZh }));
  const t = ctx.locale.bind(NS);
  const tFold = ctx.locale.bind(TURN_FOLD_NAMESPACE);

  ctx.effect(() => {
    const style = document.createElement('style');
    style.dataset.plugin = 'dsh-web-low-motion';
    style.dataset.dshLowMotion = '';
    style.textContent = css;
    const settings = document.createElement('style');
    settings.dataset.plugin = 'dsh-web-low-motion';
    settings.dataset.dshLowMotionSettings = '';
    settings.textContent = settingsCss;
    document.head.append(settings);
    let appliedMode = 'native';
    let stopOptimized;
    const sync = () => {
      const mode = state.getSnapshot().mode;
      if (mode === appliedMode) { stopOptimized?.setFrameRate(frameRateState.getSnapshot().frameRate); stopOptimized?.setRenderer(rendererState.getSnapshot().renderer); return; }
      stopOptimized?.();
      stopOptimized = undefined;
      style.remove();
      appliedMode = mode;
      if (mode === 'reduced') document.head.append(style);
      else if (mode === 'optimized') stopOptimized = mountOptimized(document, window, frameRateState.getSnapshot().frameRate, rendererState.getSnapshot().renderer);
    };
    const unsubscribe = state.subscribe(sync);
    const unsubscribeRenderer = rendererState.subscribe(sync);
    const unsubscribeFrameRate = frameRateState.subscribe(sync);
    const onStorage = event => {
      // Motion keys only: a fold-key change must never re-read and overwrite
      // this page's in-memory motion choice after a failed write.
      if (event.key === RENDERER_KEY || event.key === null) {
        try { if (event.storageArea === window.localStorage) rendererPreference.restore(); } catch {}
      }
      if (event.key === FRAME_RATE_KEY || event.key === null) {
        try { if (event.storageArea === window.localStorage) frameRatePreference.restore(); } catch {}
      }
      if (event.key !== STORAGE_KEY && event.key !== LEGACY_STORAGE_KEY && event.key !== null) return;
      try { if (event.storageArea !== window.localStorage) return; }
      catch { return; } // Blocked storage supplies no usable cross-tab update.
      preference.restore();
    };
    window.addEventListener('storage', onStorage);
    sync();
    return () => {
      unsubscribe();
      unsubscribeFrameRate();
      unsubscribeRenderer();
      window.removeEventListener('storage', onStorage);
      stopOptimized?.();
      style.remove();
      settings.remove();
    };
  });

  ctx.effect(() => {
    const style = document.createElement('style');
    style.dataset.plugin = 'dsh-web-low-motion';
    style.dataset.dshTurnFold = '';
    style.textContent = turnFoldCss;
    let registration;
    let registered = false;
    const enable = () => {
      if (registered) return;
      registered = true;
      document.head.append(style);
      // The registrar owns the Definition lifetime too, so a foreign conflict
      // removes the helper source together with its renderer.
      registration = registerTurnFold(ctx, { store: foldStore, tFold, definition: turnFoldDefinition });
    };
    const disable = () => {
      if (!registered) return;
      registered = false;
      registration?.dispose();
      registration = undefined;
      style.remove();
      foldStore.clear();
    };
    const sync = () => {
      if (foldState.getSnapshot().enabled) enable();
      else disable();
    };
    const unsubscribe = foldState.subscribe(sync);
    const onStorage = event => {
      // Fold keys only: a motion-key change must never re-read and overwrite
      // this page's in-memory fold choice after a failed write.
      if (event.key !== FOLD_STORAGE_KEY && event.key !== null) return;
      try { if (event.storageArea !== window.localStorage) return; }
      catch { return; }
      foldPreference.restore();
    };
    window.addEventListener('storage', onStorage);
    sync();
    return () => {
      unsubscribe();
      window.removeEventListener('storage', onStorage);
      disable();
    };
  });

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'web-low-motion', order: 40,
    label: () => t('nav'), locale: NS,
    inject: () => ({
      hooks: { lowMotion: state, turnFold: foldState, frameRate: frameRateState, shimmerRenderer: rendererState },
      setMode: preference.setMode,
      setFrameRate: frameRatePreference.setFrameRate,
      setRenderer: rendererPreference.setRenderer,
      setFoldEnabled: foldPreference.setEnabled,
    }),
  }, SettingsPage));
}
