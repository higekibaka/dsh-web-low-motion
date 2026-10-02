import { createSnapshotStore } from '@deepseek-ai/dsh-client-store';
import { enabled } from './config.js';
import { createPreferences, STORAGE_KEY, LEGACY_STORAGE_KEY } from './preferences.js';
import { createRendererPreferences, RENDERER_KEY } from './renderer-preferences.js';
import { createFrameRatePreferences, FRAME_RATE_KEY } from './frame-rate.js';
import { mountOptimized } from './optimized.js';
import { mountModernMotion } from './modern-motion.js';
import { SettingsPage } from './SettingsPage.jsx';
import { NS, en, zh } from './locale.js';
import css from './low-motion.css';
import settingsCss from './settings.css';

export const name = 'web-low-motion';
export const inject = ['slots', 'locale'];

/** Register the settings page and the disposable motion policy. */
export function apply(ctx, config) {
  const allowed = enabled(config);
  const state = createSnapshotStore({ preference: 'optimized', mode: allowed ? 'optimized' : 'native', allowed, warning: null });
  const preference = createPreferences(state, () => window.localStorage, allowed);
  const rendererState = createSnapshotStore({ renderer: 'css', warning: null });
  const rendererPreference = createRendererPreferences(rendererState, () => window.localStorage, allowed);
  const frameRateState = createSnapshotStore({ frameRate: 0, warning: null });
  const frameRatePreference = createFrameRatePreferences(frameRateState, () => window.localStorage, allowed);
  ctx.effect(() => ctx.locale.register(NS, { en, zh }));
  const t = ctx.locale.bind(NS);

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
    let stopModern;
    const sync = () => {
      const mode = state.getSnapshot().mode;
      if (mode === appliedMode) { stopOptimized?.setFrameRate(frameRateState.getSnapshot().frameRate); stopModern?.setFrameRate(frameRateState.getSnapshot().frameRate); stopOptimized?.setRenderer(rendererState.getSnapshot().renderer); return; }
      stopOptimized?.();
      stopModern?.();
      stopOptimized = undefined;
      stopModern = undefined;
      style.remove();
      appliedMode = mode;
      if (mode === 'reduced') document.head.append(style);
      else if (mode === 'optimized') stopOptimized = mountOptimized(document, window, frameRateState.getSnapshot().frameRate, rendererState.getSnapshot().renderer);
      if (mode !== 'native') stopModern = mountModernMotion(document, window, mode, frameRateState.getSnapshot().frameRate);
    };
    const unsubscribe = state.subscribe(sync);
    const unsubscribeRenderer = rendererState.subscribe(sync);
    const unsubscribeFrameRate = frameRateState.subscribe(sync);
    const onStorage = event => {
      // Unrelated storage events must not overwrite an unsaved motion choice.
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
      stopModern?.();
      style.remove();
      settings.remove();
    };
  });

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'web-low-motion', order: 40,
    label: () => t('nav'), locale: NS,
    inject: () => ({
      hooks: { lowMotion: state, frameRate: frameRateState, shimmerRenderer: rendererState },
      setMode: preference.setMode,
      setFrameRate: frameRatePreference.setFrameRate,
      setRenderer: rendererPreference.setRenderer,
    }),
  }, SettingsPage));
}
