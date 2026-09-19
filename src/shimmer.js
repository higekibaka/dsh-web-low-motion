import { createGradientRenderer, parseGradient } from './webgl-gradient.js';
import { frameEasing } from './frame-rate.js';

// Render the existing gradient through a stationary glyph mask. Only the gradient
// moves; the browser need not repaint the glyphs for every animation frame.
export const SHIMMER = 'data-dsh-lm-shimmer';
const typography = ['font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch',
  'font-kerning', 'font-feature-settings', 'font-variation-settings', 'font-variant',
  'line-height', 'letter-spacing', 'word-spacing', 'text-transform', 'text-indent',
  'text-rendering', 'white-space', 'direction', 'writing-mode', 'text-orientation',
  '-webkit-font-smoothing'];

/** Unknown effects or complex markup retain their native renderer. */
export function mountShimmer(source, win, frameRate = 0, renderer = 'css') {
  const doc = source.ownerDocument;
  if (!win.CSS.supports('mask-image', 'linear-gradient(white,white)')) return null;
  const native = source.getAnimations().find(a => a instanceof win.CSSAnimation
    && !a.effect?.pseudoElement && a.effect?.getTiming().iterations === Infinity);
  if (!native) return null;
  const frames = native.effect.getKeyframes();
  const timing = native.effect.getTiming();
  // Accept only a horizontal background-position animation with two endpoints.
  if (frames.length !== 2 || frames.some(f => Object.keys(f).some(k =>
    !['offset', 'computedOffset', 'easing', 'composite', 'backgroundPositionX', 'backgroundPositionY', 'backgroundPosition'].includes(k)))) return null;
  const x = frames.map(f => f.backgroundPositionX ?? f.backgroundPosition?.split(' ')[0])
    .map(value => value === '0px' ? '0%' : value);
  if (!x.every(v => v === '0%' || v === '100%') || x[0] === x[1]) return null;
  const y = frames.map(f => f.backgroundPositionY).map(value => value === '0px' ? '0%' : value);
  if (y[0] !== y[1]
    || typeof timing.duration !== 'number' || timing.duration <= 0 || timing.direction !== 'normal'
    || timing.delay !== 0 || timing.iterationStart !== 0) return null;
  const host = doc.createElement('span');
  host.setAttribute('aria-hidden', 'true');
  host.dataset.dshLmGlyphs = '';
  const band = doc.createElement('span');
  band.dataset.dshLmBand = '';
  host.append(band);
  let disposed = false;
  let refreshing = false;
  let revision = 0;
  let image = null;
  let signature = '';
  let gpu = null, gpuCanvas = null, gpuConfig = null, gpuFailed = false;
  let paused = doc.hidden || source.hasAttribute('data-dsh-lm-paused');
  function stopGPU(failed = false) {
    gpu?.dispose(); gpu = null; gpuCanvas?.remove(); gpuCanvas = null;
    band.style.visibility = ''; gpuFailed ||= failed;
    host.dataset.dshLmRenderer = gpuFailed ? 'css-fallback' : 'css';
  }
  function syncGPU(config) {
    gpuConfig = config;
    if (renderer !== 'webgl' || gpuFailed) return;
    if (!parseGradient(config.gradient)) { stopGPU(true); return; }
    if (!gpu) {
      gpuCanvas = doc.createElement('canvas'); gpuCanvas.dataset.dshLmWebgl = '';
      gpuCanvas.setAttribute('aria-hidden', 'true');
      Object.assign(gpuCanvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' });
      gpu = createGradientRenderer(gpuCanvas, win, () => stopGPU(true));
      if (!gpu) { stopGPU(true); return; }
      host.append(gpuCanvas);
    }
    if (!gpu.update(config)) { stopGPU(true); return; }
    band.style.visibility = 'hidden'; host.dataset.dshLmRenderer = 'webgl2';
    gpu.setPaused(paused);
  }
  const before = source.getAttribute(SHIMMER);
  const restore = () => before === null ? source.removeAttribute(SHIMMER) : source.setAttribute(SHIMMER, before);
  function rebuild() {
    if (disposed || refreshing) return;
    if (!source.isConnected) { dispose(); return; }
    refreshing = true;
    observer.disconnect();
    const phase = band.getAnimations()[0]?.currentTime ?? native.currentTime ?? 0;
    if (source.hasAttribute(SHIMMER) && native.currentTime !== null) native.currentTime = phase;
    restore();
    const css = win.getComputedStyle(source);
    const size = css.backgroundSize.split(' ');
    const scale = parseFloat(size[0]) / 100;
    const width = parseFloat(css.width), height = parseFloat(css.height);
    // A remote font cannot be assumed available inside an SVG image document.
    const webFont = [...(doc.fonts ?? [])].some(font => css.fontFamily.split(',').some(
      family => family.trim().replace(/^['"]|['"]$/g, '') === font.family.replace(/^['"]|['"]$/g, '')));
    const children = [...source.childNodes].filter(node => node !== host);
    const supported = !webFont && size[0]?.endsWith('%') && scale > 1 && size[1] === '100%'
      && width > 0 && height > 0 && css.backgroundClip === 'text' && css.backgroundImage.startsWith('linear-gradient(')
      && ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'].every(p => parseFloat(css[p]) === 0)
      && ['transparent', 'rgba(0, 0, 0, 0)'].includes(css.webkitTextFillColor)
      && css.writingMode === 'horizontal-tb' && children.length <= 8
      && children.every(node => node.nodeType === 3 || (node.nodeType === 1 && node.tagName === 'SPAN' && !node.children.length));
    if (!supported) {
      stopGPU(); host.remove(); signature = ''; ++revision;
      refreshing = false; watch(); return;
    }
    const clone = doc.createElement('div');
    clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    for (const property of [...typography, 'display', 'align-items', 'justify-content', 'gap', 'box-sizing', 'padding']) {
      clone.style.setProperty(property, css.getPropertyValue(property));
    }
    Object.assign(clone.style, { width: width + 'px', height: height + 'px', margin: '0',
      color: 'transparent', webkitTextFillColor: 'transparent', backgroundImage: 'linear-gradient(white,white)',
      backgroundClip: 'text', webkitBackgroundClip: 'text' });
    for (const child of children) {
      if (child.nodeType === 3) clone.append(doc.createTextNode(child.textContent));
      else {
        const span = doc.createElement('span');
        const childCss = win.getComputedStyle(child);
        for (const property of [...typography, 'display', 'margin', 'padding', 'vertical-align']) span.style.setProperty(property, childCss.getPropertyValue(property));
        span.textContent = child.textContent;
        // Solid-color clocks stay in the live DOM and are not part of the mask.
        if (childCss.webkitTextFillColor !== 'rgba(0, 0, 0, 0)' && childCss.webkitTextFillColor !== 'transparent') span.style.visibility = 'hidden';
        clone.append(span);
      }
    }
    const xml = new win.XMLSerializer().serializeToString(clone);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${xml}</foreignObject></svg>`;
    const next = svg + scale + win.devicePixelRatio;
    if (host.style.maskImage) source.setAttribute(SHIMMER, '');
    if (!host.isConnected) source.append(host);
    if (signature !== next) {
      signature = next;
      // Keep fresh live text visible until its replacement mask has decoded.
      restore();
      host.style.visibility = 'hidden';
      const id = ++revision;
      const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      const pending = new win.Image(); image = pending;
      pending.onload = () => {
        if (disposed || id !== revision || !source.isConnected) return;
        host.style.maskImage = `url("${url}")`;
        host.style.visibility = 'visible';
        const animation = band.getAnimations()[0];
        if (animation && native.currentTime !== null) animation.currentTime = native.currentTime;
        source.setAttribute(SHIMMER, '');
      };
      pending.onerror = () => { if (!disposed && id === revision) { restore(); host.remove(); signature = ''; } };
      pending.src = url;
    }
    band.style.width = size[0];
    band.style.setProperty('--dsh-lm-from', `${-(scale - 1) / scale * parseFloat(x[0])}%`);
    band.style.setProperty('--dsh-lm-to', `${-(scale - 1) / scale * parseFloat(x[1])}%`);
    band.style.animationDuration = timing.duration + 'ms';
    band.style.animationTimingFunction = frameEasing(win, frames[0].easing, timing.duration, frameRate);
    // Restore phase across text/size changes, without a JS animation loop.
    const animation = band.getAnimations()[0];
    if (animation) animation.currentTime = phase;
    syncGPU({ gradient: css.backgroundImage, width, height, dpr: win.devicePixelRatio || 1, scale,
      duration: timing.duration, easing: frames[0].easing, frameRate, animation,
      from: parseFloat(x[0]) / 100, to: parseFloat(x[1]) / 100 });
    refreshing = false;
    watch();
  }
  const observer = new win.MutationObserver(rebuild);
  function watch() {
    if (!disposed) observer.observe(source, { childList: true, characterData: true, subtree: true,
      attributes: true, attributeFilter: ['class', 'style'] });
  }
  const resize = new win.ResizeObserver(rebuild);
  const roots = new win.MutationObserver(rebuild);
  function dispose() {
    if (disposed) return;
    disposed = true; ++revision;
    const phase = band.getAnimations()[0]?.currentTime;
    if (phase != null && native.currentTime !== null) native.currentTime = phase;
    observer.disconnect(); resize.disconnect(); roots.disconnect();
    stopGPU();
    doc.fonts?.removeEventListener('loadingdone', rebuild);
    if (image) { image.onload = null; image.onerror = null; }
    host.remove(); restore();
  }
  resize.observe(source);
  for (const root of [doc.documentElement, doc.body]) roots.observe(root, { attributes: true,
    attributeFilter: ['class', 'style', 'data-theme', 'data-color-scheme', 'data-efg-enabled', 'data-efg-scheme'] });
  doc.fonts?.addEventListener('loadingdone', rebuild);
  rebuild();
  return { dispose, rebuild, setFrameRate(value) {
    if (disposed || value === frameRate) return;
    frameRate = value;
    if (gpuConfig) syncGPU({ ...gpuConfig, frameRate });
    // A timing-function edit retains the CSS animation's currentTime and mask.
    band.style.animationTimingFunction = frameEasing(win, frames[0].easing, timing.duration, frameRate);
  }, setRenderer(value) {
    if (disposed || value === renderer) return;
    renderer = value; gpuFailed = false;
    if (renderer === 'css') stopGPU(); else rebuild();
  }, setPaused(value) {
    paused = value; gpu?.setPaused(value);
  } };
}
