import { frameEasing } from './frame-rate.js';

const SHIMMER = '[data-chat-flow] [data-shimmer]';
const WHALE = '[data-chat-running] svg:has(path > animate[attributeName="d"])';
const MASK_WHALE = '[data-chat-running] span[aria-hidden="true"]:has(> span + svg)';
const ROOTS = `${SHIMMER}, ${WHALE}, ${MASK_WHALE}`;
// The host scopes keyframe names along with CSS classes; retain only the known suffixes.
const isShimmerAnimation = name => /(?:^|_)dsh-row-shimmer-(sweep|highlight)$/.test(name);

/** Control native shimmer and switch APNG whales to their static fallback while inactive. */
export function mountModernMotion(doc = document, win = window, mode = 'optimized', frameRate = 0) {
  const roots = new Map();
  const media = win.matchMedia('(prefers-reduced-motion: reduce)');
  let disposed = false;
  const property = (element, name) => [element.style.getPropertyValue(name), element.style.getPropertyPriority(name)];
  const restore = (element, name, [value, priority]) => {
    if (value) element.style.setProperty(name, value, priority);
    else element.style.removeProperty(name);
  };
  function release(root) {
    const record = roots.get(root);
    if (!record) return;
    observer?.unobserve(root);
    root.removeEventListener('animationcancel', prune, true);
    for (const [element, before] of record.targets) {
      restore(element, 'animation-timing-function', before.timing);
      restore(element, 'animation-play-state', before.play);
    }
    if (record.ownsPause) root.unpauseAnimations();
    for (const [element, display] of record.maskTargets ?? []) restore(element, 'display', display);
    roots.delete(root);
  }
  function sync(root, record) {
    const paused = mode === 'reduced' || media.matches || doc.hidden || record.offscreen;
    if (root.matches(MASK_WHALE)) {
      record.maskTargets ??= [...root.children].map(element => [element, property(element, 'display')]);
      for (const [element, display] of record.maskTargets) {
        if (paused) element.style.setProperty('display', element.tagName.toLowerCase() === 'svg' ? 'initial' : 'none', 'important');
        else restore(element, 'display', display);
      }
      return;
    }
    if (root.matches(WHALE)) {
      if (paused && !root.animationsPaused()) { root.pauseAnimations(); record.ownsPause = true; }
      else if (!paused && record.ownsPause) { root.unpauseAnimations(); record.ownsPause = false; }
      return;
    }
    const current = new Set();
    for (const animation of root.getAnimations({ subtree: true })) {
      if (!(animation instanceof win.CSSAnimation) || !isShimmerAnimation(animation.animationName)) continue;
      const element = animation.effect?.target;
      if (!(element instanceof win.Element) || element.closest(SHIMMER) !== root) continue;
      current.add(element);
      let before = record.targets.get(element);
      if (!before) {
        const css = win.getComputedStyle(element);
        before = { timing: property(element, 'animation-timing-function'), play: property(element, 'animation-play-state'),
          easing: css.animationTimingFunction, duration: parseFloat(css.animationDuration) * (css.animationDuration.endsWith('ms') ? 1 : 1000) };
        record.targets.set(element, before);
      }
      if (frameRate) element.style.setProperty('animation-timing-function', frameEasing(win, before.easing, before.duration * 2 / 3, frameRate), 'important');
      else restore(element, 'animation-timing-function', before.timing);
      if (paused) element.style.setProperty('animation-play-state', 'paused', 'important');
      else restore(element, 'animation-play-state', before.play);
    }
    for (const [element, before] of record.targets) {
      if (current.has(element)) continue;
      restore(element, 'animation-timing-function', before.timing);
      restore(element, 'animation-play-state', before.play);
      record.targets.delete(element);
    }
  }
  const observer = typeof win.IntersectionObserver === 'function' ? new win.IntersectionObserver(entries => {
    prune();
    for (const entry of entries) {
      const record = roots.get(entry.target);
      if (record) { record.offscreen = !entry.isIntersecting; sync(entry.target, record); }
    }
  }) : null;
  function prune() {
    for (const root of roots.keys()) if (!root.isConnected || !root.matches(ROOTS)) release(root);
  }
  function observe(root) {
    if (!root || disposed) return;
    if (root.matches(WHALE) && typeof root.pauseAnimations !== 'function') return;
    let record = roots.get(root);
    if (!record) {
      record = { targets: new Map(), offscreen: false, ownsPause: false };
      roots.set(root, record);
      // Detached animationcancel cannot bubble to document; prune sibling whales too.
      root.addEventListener('animationcancel', prune, true);
      observer?.observe(root);
    }
    sync(root, record);
  }
  function discover() {
    prune();
    for (const root of doc.querySelectorAll(ROOTS)) observe(root);
  }
  function started(event) {
    if (!(event.target instanceof win.Element)) return;
    prune();
    if (event.type === 'animationstart' && isShimmerAnimation(event.animationName)) {
      observe(event.target.closest(SHIMMER));
      // Both effects mount in the same running-status subtree.
      observe(event.target.closest('[data-chat-running]')?.querySelector(`${WHALE}, ${MASK_WHALE}`));
    } else if (event.type === 'beginEvent') observe(event.target.closest(WHALE));
  }
  doc.addEventListener('animationstart', started, true);
  doc.addEventListener('animationcancel', prune, true);
  doc.addEventListener('beginEvent', started, true);
  doc.addEventListener('visibilitychange', discover);
  media.addEventListener('change', discover);
  discover();
  const dispose = () => {
    disposed = true;
    doc.removeEventListener('animationstart', started, true);
    doc.removeEventListener('animationcancel', prune, true);
    doc.removeEventListener('beginEvent', started, true);
    doc.removeEventListener('visibilitychange', discover);
    media.removeEventListener('change', discover);
    observer?.disconnect();
    for (const root of roots.keys()) release(root);
  };
  dispose.setFrameRate = value => { if (!disposed && value !== frameRate) { frameRate = value; discover(); } };
  return dispose;
}
