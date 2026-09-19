import { frameEasing } from './frame-rate.js';
import baseCss from './optimized.css';
import { mountShimmer } from './shimmer.js';

const OWNERS = new Set([
  '@deepseek-ai/dsh-client-ui-tool/ToolRow.module.css',
  '@deepseek-ai/dsh-client-ui-tool/bash-sample.module.css',
  '@deepseek-ai/dsh-client-ui-chat/ReasoningRow.module.css',
  '@deepseek-ai/dsh-client-ui-chat/GenericCommandCard.module.css',
  '@deepseek-ai/dsh-client-ui-skill/SkillRow.module.css',
]);
const TEXT = '[data-chat-flow] > [role="status"][aria-live="polite"], [data-chat-flow] details[data-active] > summary > [role="status"]';
const DOT = 'svg[data-state="ongoing"]';
const SWEEP_NAME = 'dsh-lm-sweep-transform';
const PIXEL_NAME = 'dsh-lm-pixel-chase';
const MARK = 'data-dsh-lm-observed';
const PAUSED = 'data-dsh-lm-paused';

/** Match only the reviewed native sweep, including its geometry and keyframes.
 * Unknown upstream styles remain untouched rather than receiving a guessed animation. */
function nativeSweep(rule, rules, win) {
  if (!(rule instanceof win.CSSStyleRule)) return false;
  const style = rule.style;
  // CSS variables defer shorthand expansion; backgroundImage can be empty until computed.
  const background = style.backgroundImage || style.background;
  if (!/dsh-(tool|bash|reasoning|command|skill)-row-sweep/.test(style.animationName)
      || style.animationName.includes(',') || style.position !== 'absolute'
      || style.width !== '300px' || !background.startsWith('linear-gradient(')
      || !rule.selectorText.endsWith('::after')) return false;
  // Only simple lists of pseudo-element branches are accepted; never rewrite a real element.
  if (rule.selectorText.split(',').some(branch => !branch.trim().endsWith('::after')
      || !win.CSS.supports('selector(' + branch.trim() + ')'))) return false;
  const animations = rules.filter(item => item instanceof win.CSSKeyframesRule && item.name === style.animationName);
  if (animations.length !== 1) return false;
  const animation = animations[0];
  const points = new Map();
  for (const frame of animation.cssRules) {
    if (frame.style.length !== 1 || !frame.style.left) return false;
    for (const key of frame.keyText.split(',')) points.set(key.trim(), frame.style.left);
  }
  return points.size === 3 && points.get('0%') === '-300px'
    && points.get('90%') === '100%' && points.get('100%') === '100%';
}

/** Preserve moving effects without per-frame polling or streamed-body observation. */
export function mountOptimized(doc = document, win = window, frameRate = 0, renderer = 'css') {
  const style = doc.createElement('style');
  style.dataset.plugin = 'dsh-web-low-motion';
  style.dataset.dshMotionOptimized = '';
  const tracked = new Map();
  let sweepSelectors = [];
  let disposed = false;
  const hiddenBefore = doc.documentElement.getAttribute('data-dsh-lm-hidden');
  const restoreAttribute = (element, name, value) => {
    if (value === null) element.removeAttribute(name);
    else element.setAttribute(name, value);
  };
  const valid = element => element.isConnected && (
    element.matches(DOT) || element.matches(TEXT)
    || sweepSelectors.some(selector => element.matches(selector))
  );
  function animated(element) {
    return element.getAnimations({ subtree: true }).some(animation => {
      if (!(animation instanceof win.CSSAnimation) || animation.playState === 'finished') return false;
      if (element.matches(DOT)) return animation.animationName === PIXEL_NAME;
      if (animation.effect?.target !== element) return false;
      if (element.matches(TEXT)) return !animation.effect?.pseudoElement && animation.effect?.getTiming().iterations === Infinity;
      return animation.animationName === SWEEP_NAME && animation.effect?.pseudoElement === '::after';
    });
  }
  function release(element) {
    const old = tracked.get(element);
    if (!old) return;
    intersection?.unobserve(element);
    element.removeEventListener('animationcancel', old.cancel);
    old.shimmer?.dispose();
    restoreAttribute(element, MARK, old.mark);
    restoreAttribute(element, PAUSED, old.paused);
    tracked.delete(element);
  }
  const intersection = typeof win.IntersectionObserver === 'function' ? new win.IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!tracked.has(entry.target)) continue;
      if (!valid(entry.target) || !animated(entry.target)) { release(entry.target); continue; }
      entry.target.toggleAttribute(PAUSED, !entry.isIntersecting);
      tracked.get(entry.target).shimmer?.setPaused(doc.hidden || !entry.isIntersecting);
    }
  }) : null;
  function prune() {
    for (const element of tracked.keys()) if (!valid(element) || !animated(element)) release(element);
  }
  function observe(element) {
    if (!valid(element) || tracked.has(element) || !animated(element)) return;
    // Listen on the element too: cancellation from a removed subtree cannot bubble to document.
    const cancel = () => { if (!valid(element) || !animated(element)) release(element); };
    const record = { mark: element.getAttribute(MARK), paused: element.getAttribute(PAUSED), cancel };
    tracked.set(element, record);
    if (element.matches(TEXT)) record.shimmer = mountShimmer(element, win, frameRate, renderer);
    element.setAttribute(MARK, '');
    element.addEventListener('animationcancel', cancel);
    intersection?.observe(element);
  }
  function observeCurrent() {
    prune();
    for (const selector of [DOT, TEXT, ...sweepSelectors]) {
      for (const element of doc.querySelectorAll(selector)) observe(element);
    }
  }
  function refresh() {
    if (disposed) return;
    const declarations = [];
    const staticDeclarations = [];
    const selectors = new Set();
    for (const sheet of doc.querySelectorAll('style[data-plugin-css]')) {
      if (!OWNERS.has(sheet.dataset.pluginCss) || !sheet.sheet || sheet.sheet.disabled) continue;
      const rules = [...sheet.sheet.cssRules];
      for (const rule of rules) {
        if (!nativeSweep(rule, rules, win)) continue;
        const target = rule.selectorText.replace(/::after/g, '');
        try { doc.querySelector(target); }
        catch (error) { if (error.name === 'SyntaxError') continue; throw error; }
        selectors.add(target);
        const duration = rule.style.animationDuration;
        const durationMs = /^(?:\d+\.?\d*|\.\d+)(ms|s)$/.test(duration)
          ? parseFloat(duration) * (duration.endsWith('ms') ? 1 : 1000) : 0;
        // The reviewed sweep moves during 0–90%, then rests until the next cycle.
        const easing = frameEasing(win, rule.style.animationTimingFunction || 'ease', durationMs * .9, frameRate);
        declarations.push(rule.selectorText + '{'
          + 'left:-300px!important;width:calc(100% + 300px)!important;'
          + 'background-size:300px 100%!important;background-repeat:no-repeat!important;'
          + 'animation-name:' + SWEEP_NAME + '!important;'
          + (frameRate && durationMs ? 'animation-timing-function:' + easing + '!important;' : '') + '}');
        staticDeclarations.push(rule.selectorText + '{animation:none!important;background-image:none!important;}');
      }
    }
    sweepSelectors = [...selectors];
    const css = baseCss + '\n@media(prefers-reduced-motion:no-preference){' + declarations.join('\n')
      + '}\n@media(prefers-reduced-motion:reduce){' + staticDeclarations.join('\n') + '}';
    if (style.textContent !== css) style.textContent = css;
    style.dataset.nativeSweeps = String(selectors.size);
    observeCurrent();
  }
  function animationStarted(event) {
    const element = event.target;
    if (!(element instanceof win.Element)) return;
    let target;
    if (event.animationName === SWEEP_NAME && event.pseudoElement === '::after') target = element;
    else if (event.animationName === PIXEL_NAME) target = element.closest(DOT);
    else if (!event.pseudoElement && element.matches(TEXT)) target = element;
    if (target) { prune(); observe(target); }
  }
  function visibilityChanged() {
    doc.documentElement.toggleAttribute('data-dsh-lm-hidden', doc.hidden);
    for (const [element, record] of tracked) record.shimmer?.setPaused(doc.hidden || element.hasAttribute(PAUSED));
    // A visibility edge also clears targets detached while browser callbacks were throttled.
    observeCurrent();
  }
  const isOwner = node => node instanceof win.HTMLStyleElement && OWNERS.has(node.dataset.pluginCss);
  const heads = new win.MutationObserver(records => {
    // Observe stylesheet registration/HMR only, never the streaming message subtree.
    if (records.some(record => isOwner(record.target)
      || [...record.addedNodes, ...record.removedNodes].some(isOwner))) refresh();
  });
  doc.head.append(style);
  doc.addEventListener('animationstart', animationStarted, true);
  doc.addEventListener('visibilitychange', visibilityChanged);
  heads.observe(doc.head, { childList: true, subtree: true });
  refresh();
  visibilityChanged();
  const dispose = () => {
    disposed = true;
    heads.disconnect();
    intersection?.disconnect();
    doc.removeEventListener('animationstart', animationStarted, true);
    doc.removeEventListener('visibilitychange', visibilityChanged);
    for (const element of [...tracked.keys()]) release(element);
    restoreAttribute(doc.documentElement, 'data-dsh-lm-hidden', hiddenBefore);
    style.remove();
  };
  dispose.setFrameRate = value => {
    if (disposed || value === frameRate) return;
    frameRate = value;
    for (const record of tracked.values()) record.shimmer?.setFrameRate(value);
    refresh();
  };
  dispose.setRenderer = value => {
    if (disposed || renderer === value) return;
    renderer = value;
    for (const record of tracked.values()) record.shimmer?.setRenderer(value);
  };
  return dispose;
}
