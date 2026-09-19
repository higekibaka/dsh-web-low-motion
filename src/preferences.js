/** Browser-local preference; profile configuration remains a hard upper bound. */
export const MODES = ['native', 'optimized', 'reduced'];
export const STORAGE_KEY = 'dsh-web-low-motion.mode.v2';
export const LEGACY_STORAGE_KEY = 'dsh-web-low-motion.enabled.v1';

export function createPreferences(store, storageFn, allowed) {
  function publish(preference, warning) {
    const mode = allowed ? preference : 'native';
    const previous = store.getSnapshot();
    if (previous.preference === preference && previous.mode === mode &&
        previous.allowed === allowed && previous.warning === warning) return;
    store.set({ preference, mode, allowed, warning });
  }

  function restore() {
    try {
      const storage = storageFn();
      const raw = storage.getItem(STORAGE_KEY);
      if (raw !== null) {
        publish(MODES.includes(raw) ? raw : 'optimized', MODES.includes(raw) ? null : 'invalid');
        return;
      }
      const legacy = storage.getItem(LEGACY_STORAGE_KEY);
      if (legacy === 'true') publish('reduced', null);
      else if (legacy === 'false') publish('native', null);
      else publish('optimized', legacy === null ? null : 'invalid');
    } catch {
      const preference = store.getSnapshot().preference;
      publish(MODES.includes(preference) ? preference : 'optimized', 'storage');
    }
  }

  restore();
  return {
    restore,
    setMode(value) {
      if (!MODES.includes(value)) throw new TypeError('Low-motion preference must be native, optimized, or reduced');
      if (!allowed) return;
      let warning = null;
      try { storageFn().setItem(STORAGE_KEY, value); }
      catch { warning = 'storage'; }
      publish(value, warning);
    },
  };
}
