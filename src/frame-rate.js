/** Zero preserves display-paced compositor animation. Stored independently of mode. */
export const FRAME_RATES = [0, 24, 30, 60, 120];
export const FRAME_RATE_KEY = 'dsh-web-low-motion.frame-rate.v1';

export function createFrameRatePreferences(store, storageFn, allowed) {
  function publish(frameRate, warning) {
    const before = store.getSnapshot();
    if (before.frameRate !== frameRate || before.warning !== warning) store.set({ frameRate, warning });
  }
  function restore() {
    try {
      const raw = storageFn().getItem(FRAME_RATE_KEY);
      const valid = raw === null || FRAME_RATES.some(rate => String(rate) === raw);
      publish(valid ? Number(raw) : 0, valid ? null : 'frameRateInvalid');
    } catch { publish(store.getSnapshot().frameRate, 'storage'); }
  }
  restore();
  return {
    restore,
    setFrameRate(value) {
      if (!FRAME_RATES.includes(value)) throw new TypeError('Unsupported animation frame rate');
      if (!allowed) return;
      let warning = null;
      try { storageFn().setItem(FRAME_RATE_KEY, String(value)); } catch { warning = 'storage'; }
      publish(value, warning);
    },
  };
}

const caches = new WeakMap();
/** Sample the original easing once; CSS holds each value until the next sample.
 * No animation-frame JS loop, speed change, or additional canvas/context.
 * A cap controls decorative value updates, not the browser's presentation rate.
 */
export function frameEasing(win, easing, durationMs, frameRate) {
  if (!frameRate || !(durationMs > 0) || easing.includes('var(') || !win.CSS.supports('animation-timing-function', 'linear(0, 1)')) return easing;
  let cache = caches.get(win);
  if (!cache) { cache = new Map(); caches.set(win, cache); }
  const key = `${easing}|${durationMs}|${frameRate}`;
  if (cache.has(key)) return cache.get(key);
  const count = Math.max(1, Math.min(2048, Math.floor(durationMs * frameRate / 1000)));
  const effect = new win.KeyframeEffect(null, [], { duration: 1, fill: 'both', easing });
  const probe = new win.Animation(effect, null);
  const points = [];
  try {
    for (let i = 0; i < count; i++) {
      probe.currentTime = i / count;
      const progress = effect.getComputedTiming().progress;
      points.push(`${progress} ${i / count * 100}% ${(i + 1) / count * 100}%`);
    }
    probe.currentTime = 1;
    points.push(`${effect.getComputedTiming().progress} 100%`);
  } finally { probe.cancel(); }
  const result = `linear(${points.join(',')})`;
  if (cache.size >= 64) cache.delete(cache.keys().next().value);
  cache.set(key, result);
  return result;
}
