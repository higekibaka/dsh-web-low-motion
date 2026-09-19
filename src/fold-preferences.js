/** Browser-local preference for automatically folding completed turns. */
export const FOLD_STORAGE_KEY = 'dsh-web-low-motion.fold-completed.v1';

export function createFoldPreferences(store, storageFn, allowed) {
  function publish(preference, warning) {
    const enabled = Boolean(allowed && preference);
    const previous = store.getSnapshot();
    if (previous.preference === preference && previous.enabled === enabled &&
        previous.allowed === allowed && previous.warning === warning) return;
    store.set({ preference, enabled, allowed, warning });
  }

  function restore() {
    try {
      const raw = storageFn().getItem(FOLD_STORAGE_KEY);
      if (raw === 'true') publish(true, null);
      else if (raw === 'false') publish(false, null);
      else publish(true, raw === null ? null : 'foldInvalid');
    } catch {
      const preference = store.getSnapshot().preference;
      publish(typeof preference === 'boolean' ? preference : true, 'foldStorage');
    }
  }

  restore();
  return {
    restore,
    setEnabled(value) {
      if (typeof value !== 'boolean') throw new TypeError('Turn fold preference must be a boolean');
      if (!allowed) return;
      let warning = null;
      try { storageFn().setItem(FOLD_STORAGE_KEY, value ? 'true' : 'false'); }
      catch { warning = 'foldStorage'; }
      publish(value, warning);
    },
  };
}
