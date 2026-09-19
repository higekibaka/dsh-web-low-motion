export const RENDERERS = ['css', 'webgl'];
export const RENDERER_KEY = 'dsh-web-low-motion.renderer.v1';
export function createRendererPreferences(store, storageFn, allowed) {
  function publish(renderer, warning) {
    const old = store.getSnapshot();
    if (old.renderer !== renderer || old.warning !== warning) store.set({ renderer, warning });
  }
  function restore() {
    try {
      const raw = storageFn().getItem(RENDERER_KEY);
      publish(RENDERERS.includes(raw) ? raw : 'css', raw === null || RENDERERS.includes(raw) ? null : 'rendererInvalid');
    } catch { publish(store.getSnapshot().renderer, 'storage'); }
  }
  restore();
  return { restore, setRenderer(value) {
    if (!RENDERERS.includes(value)) throw new TypeError('Unsupported shimmer renderer');
    if (!allowed) return;
    let warning = null;
    try { storageFn().setItem(RENDERER_KEY, value); } catch { warning = 'storage'; }
    publish(value, warning);
  } };
}
