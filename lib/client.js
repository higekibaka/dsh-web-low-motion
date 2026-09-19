window.__ModuleLoader__.load({id:"dsh-web-low-motion",factory:(require)=>{var module={exports:{}};var exports=module.exports;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client.js
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(client_exports);
var import_dsh_client_store = require("@deepseek-ai/dsh-client-store");

// src/config.js
function enabled(config = {}) {
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    throw new TypeError("dsh-web-low-motion: config must be an object");
  }
  if (Object.keys(config).some((key) => key !== "enabled")) {
    throw new TypeError("dsh-web-low-motion: only config.enabled is supported");
  }
  if (config.enabled !== void 0 && typeof config.enabled !== "boolean") {
    throw new TypeError("dsh-web-low-motion: enabled must be a boolean");
  }
  return config.enabled ?? true;
}

// src/preferences.js
var MODES = ["native", "optimized", "reduced"];
var STORAGE_KEY = "dsh-web-low-motion.mode.v2";
var LEGACY_STORAGE_KEY = "dsh-web-low-motion.enabled.v1";
function createPreferences(store, storageFn, allowed) {
  function publish(preference, warning) {
    const mode = allowed ? preference : "native";
    const previous = store.getSnapshot();
    if (previous.preference === preference && previous.mode === mode && previous.allowed === allowed && previous.warning === warning) return;
    store.set({ preference, mode, allowed, warning });
  }
  function restore() {
    try {
      const storage = storageFn();
      const raw = storage.getItem(STORAGE_KEY);
      if (raw !== null) {
        publish(MODES.includes(raw) ? raw : "optimized", MODES.includes(raw) ? null : "invalid");
        return;
      }
      const legacy = storage.getItem(LEGACY_STORAGE_KEY);
      if (legacy === "true") publish("reduced", null);
      else if (legacy === "false") publish("native", null);
      else publish("optimized", legacy === null ? null : "invalid");
    } catch {
      const preference = store.getSnapshot().preference;
      publish(MODES.includes(preference) ? preference : "optimized", "storage");
    }
  }
  restore();
  return {
    restore,
    setMode(value) {
      if (!MODES.includes(value)) throw new TypeError("Low-motion preference must be native, optimized, or reduced");
      if (!allowed) return;
      let warning = null;
      try {
        storageFn().setItem(STORAGE_KEY, value);
      } catch {
        warning = "storage";
      }
      publish(value, warning);
    }
  };
}

// src/renderer-preferences.js
var RENDERERS = ["css", "webgl"];
var RENDERER_KEY = "dsh-web-low-motion.renderer.v1";
function createRendererPreferences(store, storageFn, allowed) {
  function publish(renderer, warning) {
    const old = store.getSnapshot();
    if (old.renderer !== renderer || old.warning !== warning) store.set({ renderer, warning });
  }
  function restore() {
    try {
      const raw = storageFn().getItem(RENDERER_KEY);
      publish(RENDERERS.includes(raw) ? raw : "css", raw === null || RENDERERS.includes(raw) ? null : "rendererInvalid");
    } catch {
      publish(store.getSnapshot().renderer, "storage");
    }
  }
  restore();
  return { restore, setRenderer(value) {
    if (!RENDERERS.includes(value)) throw new TypeError("Unsupported shimmer renderer");
    if (!allowed) return;
    let warning = null;
    try {
      storageFn().setItem(RENDERER_KEY, value);
    } catch {
      warning = "storage";
    }
    publish(value, warning);
  } };
}

// src/frame-rate.js
var FRAME_RATES = [0, 24, 30, 60, 120];
var FRAME_RATE_KEY = "dsh-web-low-motion.frame-rate.v1";
function createFrameRatePreferences(store, storageFn, allowed) {
  function publish(frameRate, warning) {
    const before = store.getSnapshot();
    if (before.frameRate !== frameRate || before.warning !== warning) store.set({ frameRate, warning });
  }
  function restore() {
    try {
      const raw = storageFn().getItem(FRAME_RATE_KEY);
      const valid = raw === null || FRAME_RATES.some((rate) => String(rate) === raw);
      publish(valid ? Number(raw) : 0, valid ? null : "frameRateInvalid");
    } catch {
      publish(store.getSnapshot().frameRate, "storage");
    }
  }
  restore();
  return {
    restore,
    setFrameRate(value) {
      if (!FRAME_RATES.includes(value)) throw new TypeError("Unsupported animation frame rate");
      if (!allowed) return;
      let warning = null;
      try {
        storageFn().setItem(FRAME_RATE_KEY, String(value));
      } catch {
        warning = "storage";
      }
      publish(value, warning);
    }
  };
}
var caches = /* @__PURE__ */ new WeakMap();
function frameEasing(win, easing, durationMs, frameRate) {
  if (!frameRate || !(durationMs > 0) || easing.includes("var(") || !win.CSS.supports("animation-timing-function", "linear(0, 1)")) return easing;
  let cache = caches.get(win);
  if (!cache) {
    cache = /* @__PURE__ */ new Map();
    caches.set(win, cache);
  }
  const key = `${easing}|${durationMs}|${frameRate}`;
  if (cache.has(key)) return cache.get(key);
  const count = Math.max(1, Math.min(2048, Math.floor(durationMs * frameRate / 1e3)));
  const effect = new win.KeyframeEffect(null, [], { duration: 1, fill: "both", easing });
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
  } finally {
    probe.cancel();
  }
  const result = `linear(${points.join(",")})`;
  if (cache.size >= 64) cache.delete(cache.keys().next().value);
  cache.set(key, result);
  return result;
}

// src/fold-preferences.js
var FOLD_STORAGE_KEY = "dsh-web-low-motion.fold-completed.v1";
function createFoldPreferences(store, storageFn, allowed) {
  function publish(preference, warning) {
    const enabled2 = Boolean(allowed && preference);
    const previous = store.getSnapshot();
    if (previous.preference === preference && previous.enabled === enabled2 && previous.allowed === allowed && previous.warning === warning) return;
    store.set({ preference, enabled: enabled2, allowed, warning });
  }
  function restore() {
    try {
      const raw = storageFn().getItem(FOLD_STORAGE_KEY);
      if (raw === "true") publish(true, null);
      else if (raw === "false") publish(false, null);
      else publish(true, raw === null ? null : "foldInvalid");
    } catch {
      const preference = store.getSnapshot().preference;
      publish(typeof preference === "boolean" ? preference : true, "foldStorage");
    }
  }
  restore();
  return {
    restore,
    setEnabled(value) {
      if (typeof value !== "boolean") throw new TypeError("Turn fold preference must be a boolean");
      if (!allowed) return;
      let warning = null;
      try {
        storageFn().setItem(FOLD_STORAGE_KEY, value ? "true" : "false");
      } catch {
        warning = "foldStorage";
      }
      publish(value, warning);
    }
  };
}

// src/optimized.css
var optimized_default = '@keyframes dsh-lm-sweep-transform {\n  0% { transform: translateX(0); }\n  90%, 100% { transform: translateX(100%); }\n}\n@keyframes dsh-lm-pixel-chase {\n  0% { opacity: 1; }\n  12.5% { opacity: .6; }\n  25% { opacity: .35; }\n  37.5%, 100% { opacity: .15; }\n}\n@keyframes dsh-lm-shimmer-translate {\n  from { transform: translateX(var(--dsh-lm-from)); }\n  to { transform: translateX(var(--dsh-lm-to)); }\n}\n@media (prefers-reduced-motion: no-preference) {\n  [data-dsh-lm-shimmer] {\n    position: relative !important;\n    background-size: 0 0 !important;\n    animation-play-state: paused !important;\n  }\n  [data-dsh-lm-glyphs] {\n    position: absolute; inset: 0; pointer-events: none;\n    visibility: hidden;\n    background-image: inherit; background-size: 0 0;\n    mask-size: 100% 100%; mask-repeat: no-repeat;\n    contain: paint;\n  }\n  [data-dsh-lm-band] {\n    position: absolute; left: 0; top: 0; height: 100%;\n    background-image: inherit;\n    animation: dsh-lm-shimmer-translate 1.8s linear infinite;\n  }\n  svg[data-state="ongoing"] rect {\n    animation-name: dsh-lm-pixel-chase !important;\n    animation-timing-function: step-end !important;\n  }\n}\n@media (prefers-reduced-motion: reduce) {\n  [data-chat-flow] > [role="status"][aria-live="polite"],\n  [data-chat-flow] details[data-active] > summary > [role="status"] {\n    animation: none !important;\n    opacity: 1 !important;\n  }\n  svg[data-state="ongoing"] rect { animation: none !important; opacity: 1 !important; }\n}\n/* Only elements registered by the decorative-animation observer carry these marks. */\n[data-dsh-lm-paused], [data-dsh-lm-paused]::after, [data-dsh-lm-paused] rect, [data-dsh-lm-paused] [data-dsh-lm-band],\nhtml[data-dsh-lm-hidden] [data-dsh-lm-observed],\nhtml[data-dsh-lm-hidden] [data-dsh-lm-observed]::after,\nhtml[data-dsh-lm-hidden] [data-dsh-lm-observed] rect,\nhtml[data-dsh-lm-hidden] [data-dsh-lm-band] {\n  animation-play-state: paused !important;\n}\n';

// src/webgl-gradient.js
var hubs = /* @__PURE__ */ new WeakMap();
function hubFor(win) {
  let hub = hubs.get(win);
  if (hub) return hub;
  const active = /* @__PURE__ */ new Set();
  let handle = null;
  const tick = () => {
    handle = null;
    for (const item of [...active]) item.draw();
    if (active.size) handle = win.requestAnimationFrame(tick);
  };
  hub = {
    contexts: 0,
    add(item) {
      active.add(item);
      if (handle === null) handle = win.requestAnimationFrame(tick);
    },
    remove(item) {
      active.delete(item);
      if (!active.size && handle !== null) {
        win.cancelAnimationFrame(handle);
        handle = null;
      }
    }
  };
  hubs.set(win, hub);
  return hub;
}
function parseGradient(text) {
  const match = /^linear-gradient\(90deg,\s*(.*)\)$/.exec(text);
  if (!match) return null;
  const tokens = match[1].match(/rgba?\([^)]*\)(?:\s+[\d.]+%)?/g);
  if (!tokens || tokens.length < 2 || tokens.length > 8 || match[1].replace(/rgba?\([^)]*\)(?:\s+[\d.]+%)?/g, "").replace(/[\s,]/g, "")) return null;
  const stops = tokens.map((token) => {
    const m = /^rgba?\(([^)]+)\)(?:\s+([\d.]+)%)?$/.exec(token);
    const values = m[1].split(",").map(Number);
    if (![3, 4].includes(values.length) || !values.every(Number.isFinite) || values.slice(0, 3).some((n) => n < 0 || n > 255) || values[3] !== void 0 && (values[3] < 0 || values[3] > 1)) return null;
    const alpha = values[3] ?? 1;
    return { color: [...values.slice(0, 3).map((n) => n / 255 * alpha), alpha], at: m[2] === void 0 ? null : Number(m[2]) / 100 };
  });
  if (stops.some((s) => !s)) return null;
  stops[0].at ??= 0;
  stops.at(-1).at ??= 1;
  let previous = 0;
  for (const stop of stops) if (stop.at !== null) {
    if (stop.at < previous || stop.at > 1) return null;
    previous = stop.at;
  }
  for (let i = 1; i < stops.length - 1; i++) if (stops[i].at === null) {
    let end = i;
    while (stops[end].at === null) end++;
    const start = i - 1;
    for (let j = i; j < end; j++) stops[j].at = stops[start].at + (stops[end].at - stops[start].at) * (j - start) / (end - start);
    i = end - 1;
  }
  return stops;
}
var vertex = `#version 300 es
out vec2 uv;
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);uv=p;gl_Position=vec4(p*2.-1.,0,1);}`;
var fragment = `#version 300 es
precision highp float;
in vec2 uv;uniform float phase;uniform float scale;
uniform vec4 colors[8];uniform float stops[8];uniform int count;out vec4 color;
void main(){float x=(uv.x+(scale-1.)*phase)/scale;vec4 c=colors[0];
for(int i=1;i<8;i++){if(i>=count)break;float span=stops[i]-stops[i-1];
float t=span==0.?step(stops[i],x):clamp((x-stops[i-1])/span,0.,1.);c=mix(c,colors[i],t);}color=c;}`;
function createGradientRenderer(canvas, win, onFailure) {
  const hub = hubFor(win);
  if (hub.contexts >= 4) return null;
  let gl, program, probe, effect, configured, phaseLocation;
  const shaders = [];
  let disposed = false, paused = true, counted = false, lastSample = null, signature = "";
  let maxSize = 0;
  function dispose() {
    if (disposed) return;
    disposed = true;
    hub.remove(item);
    canvas.removeEventListener("webglcontextlost", lost);
    probe?.cancel();
    if (gl) {
      if (program) gl.deleteProgram(program);
      for (const shader of shaders) gl.deleteShader(shader);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
    if (counted) {
      counted = false;
      hub.contexts--;
    }
  }
  function lost(event) {
    event.preventDefault();
    dispose();
    onFailure();
  }
  function draw() {
    if (disposed || !configured) return;
    try {
      const { animation, duration, frameRate, from, to } = configured;
      const time = ((animation.currentTime ?? 0) % duration + duration) % duration;
      const count = frameRate ? Math.max(1, Math.min(2048, Math.floor(duration * frameRate / 1e3))) : 0;
      const sample = count ? Math.floor(time / duration * count) * duration / count : time;
      if (lastSample === sample) return;
      probe.currentTime = sample;
      const progress = effect.getComputedTiming().progress;
      if (progress === null) return;
      gl.uniform1f(phaseLocation, from + (to - from) * progress);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      lastSample = sample;
    } catch {
      dispose();
      onFailure();
    }
  }
  const item = { draw };
  try {
    gl = canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false
    });
    if (!gl) return null;
    counted = true;
    hub.contexts++;
    canvas.addEventListener("webglcontextlost", lost);
    for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
      const shader = gl.createShader(type);
      if (!shader) throw Error("Shader allocation");
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error("Shader compilation");
    }
    program = gl.createProgram();
    if (!program) throw Error("Program allocation");
    for (const shader of shaders) gl.attachShader(program, shader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error("Program link");
    maxSize = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
    gl.useProgram(program);
    phaseLocation = gl.getUniformLocation(program, "phase");
  } catch {
    dispose();
    return null;
  }
  return {
    update(next) {
      if (disposed) return false;
      const stops = parseGradient(next.gradient);
      if (!stops || !(next.width > 0 && next.height > 0 && next.scale > 1 && next.duration > 0) || !next.animation) return false;
      try {
        const key = [next.gradient, next.width, next.height, next.dpr, next.scale].join("|");
        if (signature !== key) {
          const width = Math.ceil(next.width * next.dpr), height = Math.ceil(next.height * next.dpr);
          if (width > maxSize || height > maxSize) return false;
          canvas.width = width;
          canvas.height = height;
          gl.viewport(0, 0, width, height);
          const colors = new Float32Array(32), points = new Float32Array(8);
          stops.forEach((s, i) => {
            colors.set(s.color, i * 4);
            points[i] = s.at;
          });
          gl.uniform4fv(gl.getUniformLocation(program, "colors"), colors);
          gl.uniform1fv(gl.getUniformLocation(program, "stops"), points);
          gl.uniform1i(gl.getUniformLocation(program, "count"), stops.length);
          gl.uniform1f(gl.getUniformLocation(program, "scale"), next.scale);
          signature = key;
          lastSample = null;
        }
        if (!configured || configured.duration !== next.duration || configured.easing !== next.easing) {
          probe?.cancel();
          effect = new win.KeyframeEffect(null, [], { duration: next.duration, easing: next.easing, fill: "both" });
          probe = new win.Animation(effect, null);
          lastSample = null;
        }
        if (configured?.frameRate !== next.frameRate) lastSample = null;
        configured = next;
        if (!paused) draw();
        return !disposed;
      } catch {
        return false;
      }
    },
    setPaused(value) {
      if (disposed || paused === value) return;
      paused = value;
      if (paused) hub.remove(item);
      else {
        draw();
        if (!disposed) hub.add(item);
      }
    },
    dispose
  };
}

// src/shimmer.js
var SHIMMER = "data-dsh-lm-shimmer";
var typography = [
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "font-stretch",
  "font-kerning",
  "font-feature-settings",
  "font-variation-settings",
  "font-variant",
  "line-height",
  "letter-spacing",
  "word-spacing",
  "text-transform",
  "text-indent",
  "text-rendering",
  "white-space",
  "direction",
  "writing-mode",
  "text-orientation",
  "-webkit-font-smoothing"
];
function mountShimmer(source, win, frameRate = 0, renderer = "css") {
  const doc = source.ownerDocument;
  if (!win.CSS.supports("mask-image", "linear-gradient(white,white)")) return null;
  const native = source.getAnimations().find((a) => a instanceof win.CSSAnimation && !a.effect?.pseudoElement && a.effect?.getTiming().iterations === Infinity);
  if (!native) return null;
  const frames = native.effect.getKeyframes();
  const timing = native.effect.getTiming();
  if (frames.length !== 2 || frames.some((f) => Object.keys(f).some((k) => !["offset", "computedOffset", "easing", "composite", "backgroundPositionX", "backgroundPositionY", "backgroundPosition"].includes(k)))) return null;
  const x = frames.map((f) => f.backgroundPositionX ?? f.backgroundPosition?.split(" ")[0]).map((value) => value === "0px" ? "0%" : value);
  if (!x.every((v) => v === "0%" || v === "100%") || x[0] === x[1]) return null;
  const y = frames.map((f) => f.backgroundPositionY).map((value) => value === "0px" ? "0%" : value);
  if (y[0] !== y[1] || typeof timing.duration !== "number" || timing.duration <= 0 || timing.direction !== "normal" || timing.delay !== 0 || timing.iterationStart !== 0) return null;
  const host = doc.createElement("span");
  host.setAttribute("aria-hidden", "true");
  host.dataset.dshLmGlyphs = "";
  const band = doc.createElement("span");
  band.dataset.dshLmBand = "";
  host.append(band);
  let disposed = false;
  let refreshing = false;
  let revision = 0;
  let image = null;
  let signature = "";
  let gpu = null, gpuCanvas = null, gpuConfig = null, gpuFailed = false;
  let paused = doc.hidden || source.hasAttribute("data-dsh-lm-paused");
  function stopGPU(failed = false) {
    gpu?.dispose();
    gpu = null;
    gpuCanvas?.remove();
    gpuCanvas = null;
    band.style.visibility = "";
    gpuFailed ||= failed;
    host.dataset.dshLmRenderer = gpuFailed ? "css-fallback" : "css";
  }
  function syncGPU(config) {
    gpuConfig = config;
    if (renderer !== "webgl" || gpuFailed) return;
    if (!parseGradient(config.gradient)) {
      stopGPU(true);
      return;
    }
    if (!gpu) {
      gpuCanvas = doc.createElement("canvas");
      gpuCanvas.dataset.dshLmWebgl = "";
      gpuCanvas.setAttribute("aria-hidden", "true");
      Object.assign(gpuCanvas.style, { position: "absolute", inset: "0", width: "100%", height: "100%", pointerEvents: "none" });
      gpu = createGradientRenderer(gpuCanvas, win, () => stopGPU(true));
      if (!gpu) {
        stopGPU(true);
        return;
      }
      host.append(gpuCanvas);
    }
    if (!gpu.update(config)) {
      stopGPU(true);
      return;
    }
    band.style.visibility = "hidden";
    host.dataset.dshLmRenderer = "webgl2";
    gpu.setPaused(paused);
  }
  const before = source.getAttribute(SHIMMER);
  const restore = () => before === null ? source.removeAttribute(SHIMMER) : source.setAttribute(SHIMMER, before);
  function rebuild() {
    if (disposed || refreshing) return;
    if (!source.isConnected) {
      dispose();
      return;
    }
    refreshing = true;
    observer.disconnect();
    const phase = band.getAnimations()[0]?.currentTime ?? native.currentTime ?? 0;
    if (source.hasAttribute(SHIMMER) && native.currentTime !== null) native.currentTime = phase;
    restore();
    const css = win.getComputedStyle(source);
    const size = css.backgroundSize.split(" ");
    const scale = parseFloat(size[0]) / 100;
    const width = parseFloat(css.width), height = parseFloat(css.height);
    const webFont = [...doc.fonts ?? []].some((font) => css.fontFamily.split(",").some(
      (family) => family.trim().replace(/^['"]|['"]$/g, "") === font.family.replace(/^['"]|['"]$/g, "")
    ));
    const children = [...source.childNodes].filter((node) => node !== host);
    const supported = !webFont && size[0]?.endsWith("%") && scale > 1 && size[1] === "100%" && width > 0 && height > 0 && css.backgroundClip === "text" && css.backgroundImage.startsWith("linear-gradient(") && ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth"].every((p) => parseFloat(css[p]) === 0) && ["transparent", "rgba(0, 0, 0, 0)"].includes(css.webkitTextFillColor) && css.writingMode === "horizontal-tb" && children.length <= 8 && children.every((node) => node.nodeType === 3 || node.nodeType === 1 && node.tagName === "SPAN" && !node.children.length);
    if (!supported) {
      stopGPU();
      host.remove();
      signature = "";
      ++revision;
      refreshing = false;
      watch();
      return;
    }
    const clone = doc.createElement("div");
    clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    for (const property of [...typography, "display", "align-items", "justify-content", "gap", "box-sizing", "padding"]) {
      clone.style.setProperty(property, css.getPropertyValue(property));
    }
    Object.assign(clone.style, {
      width: width + "px",
      height: height + "px",
      margin: "0",
      color: "transparent",
      webkitTextFillColor: "transparent",
      backgroundImage: "linear-gradient(white,white)",
      backgroundClip: "text",
      webkitBackgroundClip: "text"
    });
    for (const child of children) {
      if (child.nodeType === 3) clone.append(doc.createTextNode(child.textContent));
      else {
        const span = doc.createElement("span");
        const childCss = win.getComputedStyle(child);
        for (const property of [...typography, "display", "margin", "padding", "vertical-align"]) span.style.setProperty(property, childCss.getPropertyValue(property));
        span.textContent = child.textContent;
        if (childCss.webkitTextFillColor !== "rgba(0, 0, 0, 0)" && childCss.webkitTextFillColor !== "transparent") span.style.visibility = "hidden";
        clone.append(span);
      }
    }
    const xml = new win.XMLSerializer().serializeToString(clone);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${xml}</foreignObject></svg>`;
    const next = svg + scale + win.devicePixelRatio;
    if (host.style.maskImage) source.setAttribute(SHIMMER, "");
    if (!host.isConnected) source.append(host);
    if (signature !== next) {
      signature = next;
      restore();
      host.style.visibility = "hidden";
      const id = ++revision;
      const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
      const pending = new win.Image();
      image = pending;
      pending.onload = () => {
        if (disposed || id !== revision || !source.isConnected) return;
        host.style.maskImage = `url("${url}")`;
        host.style.visibility = "visible";
        const animation2 = band.getAnimations()[0];
        if (animation2 && native.currentTime !== null) animation2.currentTime = native.currentTime;
        source.setAttribute(SHIMMER, "");
      };
      pending.onerror = () => {
        if (!disposed && id === revision) {
          restore();
          host.remove();
          signature = "";
        }
      };
      pending.src = url;
    }
    band.style.width = size[0];
    band.style.setProperty("--dsh-lm-from", `${-(scale - 1) / scale * parseFloat(x[0])}%`);
    band.style.setProperty("--dsh-lm-to", `${-(scale - 1) / scale * parseFloat(x[1])}%`);
    band.style.animationDuration = timing.duration + "ms";
    band.style.animationTimingFunction = frameEasing(win, frames[0].easing, timing.duration, frameRate);
    const animation = band.getAnimations()[0];
    if (animation) animation.currentTime = phase;
    syncGPU({
      gradient: css.backgroundImage,
      width,
      height,
      dpr: win.devicePixelRatio || 1,
      scale,
      duration: timing.duration,
      easing: frames[0].easing,
      frameRate,
      animation,
      from: parseFloat(x[0]) / 100,
      to: parseFloat(x[1]) / 100
    });
    refreshing = false;
    watch();
  }
  const observer = new win.MutationObserver(rebuild);
  function watch() {
    if (!disposed) observer.observe(source, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style"]
    });
  }
  const resize = new win.ResizeObserver(rebuild);
  const roots = new win.MutationObserver(rebuild);
  function dispose() {
    if (disposed) return;
    disposed = true;
    ++revision;
    const phase = band.getAnimations()[0]?.currentTime;
    if (phase != null && native.currentTime !== null) native.currentTime = phase;
    observer.disconnect();
    resize.disconnect();
    roots.disconnect();
    stopGPU();
    doc.fonts?.removeEventListener("loadingdone", rebuild);
    if (image) {
      image.onload = null;
      image.onerror = null;
    }
    host.remove();
    restore();
  }
  resize.observe(source);
  for (const root of [doc.documentElement, doc.body]) roots.observe(root, {
    attributes: true,
    attributeFilter: ["class", "style", "data-theme", "data-color-scheme", "data-efg-enabled", "data-efg-scheme"]
  });
  doc.fonts?.addEventListener("loadingdone", rebuild);
  rebuild();
  return { dispose, rebuild, setFrameRate(value) {
    if (disposed || value === frameRate) return;
    frameRate = value;
    if (gpuConfig) syncGPU({ ...gpuConfig, frameRate });
    band.style.animationTimingFunction = frameEasing(win, frames[0].easing, timing.duration, frameRate);
  }, setRenderer(value) {
    if (disposed || value === renderer) return;
    renderer = value;
    gpuFailed = false;
    if (renderer === "css") stopGPU();
    else rebuild();
  }, setPaused(value) {
    paused = value;
    gpu?.setPaused(value);
  } };
}

// src/optimized.js
var OWNERS = /* @__PURE__ */ new Set([
  "@deepseek-ai/dsh-client-ui-tool/ToolRow.module.css",
  "@deepseek-ai/dsh-client-ui-tool/bash-sample.module.css",
  "@deepseek-ai/dsh-client-ui-chat/ReasoningRow.module.css",
  "@deepseek-ai/dsh-client-ui-chat/GenericCommandCard.module.css",
  "@deepseek-ai/dsh-client-ui-skill/SkillRow.module.css"
]);
var TEXT = '[data-chat-flow] > [role="status"][aria-live="polite"], [data-chat-flow] details[data-active] > summary > [role="status"]';
var DOT = 'svg[data-state="ongoing"]';
var SWEEP_NAME = "dsh-lm-sweep-transform";
var PIXEL_NAME = "dsh-lm-pixel-chase";
var MARK = "data-dsh-lm-observed";
var PAUSED = "data-dsh-lm-paused";
function nativeSweep(rule, rules, win) {
  if (!(rule instanceof win.CSSStyleRule)) return false;
  const style = rule.style;
  const background = style.backgroundImage || style.background;
  if (!/dsh-(tool|bash|reasoning|command|skill)-row-sweep/.test(style.animationName) || style.animationName.includes(",") || style.position !== "absolute" || style.width !== "300px" || !background.startsWith("linear-gradient(") || !rule.selectorText.endsWith("::after")) return false;
  if (rule.selectorText.split(",").some((branch) => !branch.trim().endsWith("::after") || !win.CSS.supports("selector(" + branch.trim() + ")"))) return false;
  const animations = rules.filter((item) => item instanceof win.CSSKeyframesRule && item.name === style.animationName);
  if (animations.length !== 1) return false;
  const animation = animations[0];
  const points = /* @__PURE__ */ new Map();
  for (const frame of animation.cssRules) {
    if (frame.style.length !== 1 || !frame.style.left) return false;
    for (const key of frame.keyText.split(",")) points.set(key.trim(), frame.style.left);
  }
  return points.size === 3 && points.get("0%") === "-300px" && points.get("90%") === "100%" && points.get("100%") === "100%";
}
function mountOptimized(doc = document, win = window, frameRate = 0, renderer = "css") {
  const style = doc.createElement("style");
  style.dataset.plugin = "dsh-web-low-motion";
  style.dataset.dshMotionOptimized = "";
  const tracked = /* @__PURE__ */ new Map();
  let sweepSelectors = [];
  let disposed = false;
  const hiddenBefore = doc.documentElement.getAttribute("data-dsh-lm-hidden");
  const restoreAttribute = (element, name2, value) => {
    if (value === null) element.removeAttribute(name2);
    else element.setAttribute(name2, value);
  };
  const valid = (element) => element.isConnected && (element.matches(DOT) || element.matches(TEXT) || sweepSelectors.some((selector) => element.matches(selector)));
  function animated(element) {
    return element.getAnimations({ subtree: true }).some((animation) => {
      if (!(animation instanceof win.CSSAnimation) || animation.playState === "finished") return false;
      if (element.matches(DOT)) return animation.animationName === PIXEL_NAME;
      if (animation.effect?.target !== element) return false;
      if (element.matches(TEXT)) return !animation.effect?.pseudoElement && animation.effect?.getTiming().iterations === Infinity;
      return animation.animationName === SWEEP_NAME && animation.effect?.pseudoElement === "::after";
    });
  }
  function release(element) {
    const old = tracked.get(element);
    if (!old) return;
    intersection?.unobserve(element);
    element.removeEventListener("animationcancel", old.cancel);
    old.shimmer?.dispose();
    restoreAttribute(element, MARK, old.mark);
    restoreAttribute(element, PAUSED, old.paused);
    tracked.delete(element);
  }
  const intersection = typeof win.IntersectionObserver === "function" ? new win.IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!tracked.has(entry.target)) continue;
      if (!valid(entry.target) || !animated(entry.target)) {
        release(entry.target);
        continue;
      }
      entry.target.toggleAttribute(PAUSED, !entry.isIntersecting);
      tracked.get(entry.target).shimmer?.setPaused(doc.hidden || !entry.isIntersecting);
    }
  }) : null;
  function prune() {
    for (const element of tracked.keys()) if (!valid(element) || !animated(element)) release(element);
  }
  function observe(element) {
    if (!valid(element) || tracked.has(element) || !animated(element)) return;
    const cancel = () => {
      if (!valid(element) || !animated(element)) release(element);
    };
    const record = { mark: element.getAttribute(MARK), paused: element.getAttribute(PAUSED), cancel };
    tracked.set(element, record);
    if (element.matches(TEXT)) record.shimmer = mountShimmer(element, win, frameRate, renderer);
    element.setAttribute(MARK, "");
    element.addEventListener("animationcancel", cancel);
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
    const selectors = /* @__PURE__ */ new Set();
    for (const sheet of doc.querySelectorAll("style[data-plugin-css]")) {
      if (!OWNERS.has(sheet.dataset.pluginCss) || !sheet.sheet || sheet.sheet.disabled) continue;
      const rules = [...sheet.sheet.cssRules];
      for (const rule of rules) {
        if (!nativeSweep(rule, rules, win)) continue;
        const target = rule.selectorText.replace(/::after/g, "");
        try {
          doc.querySelector(target);
        } catch (error) {
          if (error.name === "SyntaxError") continue;
          throw error;
        }
        selectors.add(target);
        const duration = rule.style.animationDuration;
        const durationMs = /^(?:\d+\.?\d*|\.\d+)(ms|s)$/.test(duration) ? parseFloat(duration) * (duration.endsWith("ms") ? 1 : 1e3) : 0;
        const easing = frameEasing(win, rule.style.animationTimingFunction || "ease", durationMs * 0.9, frameRate);
        declarations.push(rule.selectorText + "{left:-300px!important;width:calc(100% + 300px)!important;background-size:300px 100%!important;background-repeat:no-repeat!important;animation-name:" + SWEEP_NAME + "!important;" + (frameRate && durationMs ? "animation-timing-function:" + easing + "!important;" : "") + "}");
        staticDeclarations.push(rule.selectorText + "{animation:none!important;background-image:none!important;}");
      }
    }
    sweepSelectors = [...selectors];
    const css = optimized_default + "\n@media(prefers-reduced-motion:no-preference){" + declarations.join("\n") + "}\n@media(prefers-reduced-motion:reduce){" + staticDeclarations.join("\n") + "}";
    if (style.textContent !== css) style.textContent = css;
    style.dataset.nativeSweeps = String(selectors.size);
    observeCurrent();
  }
  function animationStarted(event) {
    const element = event.target;
    if (!(element instanceof win.Element)) return;
    let target;
    if (event.animationName === SWEEP_NAME && event.pseudoElement === "::after") target = element;
    else if (event.animationName === PIXEL_NAME) target = element.closest(DOT);
    else if (!event.pseudoElement && element.matches(TEXT)) target = element;
    if (target) {
      prune();
      observe(target);
    }
  }
  function visibilityChanged() {
    doc.documentElement.toggleAttribute("data-dsh-lm-hidden", doc.hidden);
    for (const [element, record] of tracked) record.shimmer?.setPaused(doc.hidden || element.hasAttribute(PAUSED));
    observeCurrent();
  }
  const isOwner = (node) => node instanceof win.HTMLStyleElement && OWNERS.has(node.dataset.pluginCss);
  const heads = new win.MutationObserver((records) => {
    if (records.some((record) => isOwner(record.target) || [...record.addedNodes, ...record.removedNodes].some(isOwner))) refresh();
  });
  doc.head.append(style);
  doc.addEventListener("animationstart", animationStarted, true);
  doc.addEventListener("visibilitychange", visibilityChanged);
  heads.observe(doc.head, { childList: true, subtree: true });
  refresh();
  visibilityChanged();
  const dispose = () => {
    disposed = true;
    heads.disconnect();
    intersection?.disconnect();
    doc.removeEventListener("animationstart", animationStarted, true);
    doc.removeEventListener("visibilitychange", visibilityChanged);
    for (const element of [...tracked.keys()]) release(element);
    restoreAttribute(doc.documentElement, "data-dsh-lm-hidden", hiddenBefore);
    style.remove();
  };
  dispose.setFrameRate = (value) => {
    if (disposed || value === frameRate) return;
    frameRate = value;
    for (const record of tracked.values()) record.shimmer?.setFrameRate(value);
    refresh();
  };
  dispose.setRenderer = (value) => {
    if (disposed || renderer === value) return;
    renderer = value;
    for (const record of tracked.values()) record.shimmer?.setRenderer(value);
  };
  return dispose;
}

// src/SettingsPage.jsx
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
var DETAILS = {
  native: ["nativeDetail"],
  optimized: ["optimizedSweep", "optimizedDots", "optimizedText", "optimizedPause", "systemMotion"],
  reduced: ["reducedSweep", "reducedDots", "reducedText"]
};
function SettingsPage({ useLowMotion, setMode, useTurnFold, setFoldEnabled, useFrameRate, setFrameRate, useShimmerRenderer, setRenderer, t }) {
  const state = useLowMotion((value) => value);
  const fold = useTurnFold((value) => value);
  const renderer = useShimmerRenderer((value) => value);
  const rate = useFrameRate((value) => value);
  const id = (0, import_react.useId)();
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dsh-lm-page", "data-low-motion-settings": "", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: t("title") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-lm-description", children: t("description") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-lm-card", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
        "fieldset",
        {
          className: "dsh-lm-control",
          disabled: !state.allowed,
          "aria-describedby": id + "-description" + (!state.allowed ? " " + id + "-locked" : ""),
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("legend", { className: "dsh-lm-label", children: t("mode") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { id: id + "-description", children: t("modeDescription") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-lm-options", children: MODES.map((mode) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "dsh-lm-option", "data-selected": state.preference === mode, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "input",
                {
                  className: "dsh-lm-radio",
                  type: "radio",
                  name: id + "-mode",
                  value: mode,
                  checked: state.preference === mode,
                  disabled: !state.allowed,
                  "aria-labelledby": id + "-" + mode + "-label",
                  "aria-describedby": id + "-" + mode + "-description",
                  onChange: (event) => {
                    if (event.target.checked) setMode(mode);
                  }
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-lm-option-content", children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-lm-option-title", id: id + "-" + mode + "-label", children: [
                  t(mode + "Label"),
                  mode === "optimized" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-lm-recommended", children: t("recommended") })
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-lm-option-description", id: id + "-" + mode + "-description", children: t(mode + "Description") })
              ] })
            ] }, mode)) })
          ]
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-lm-frame-rate", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { htmlFor: id + "-renderer", children: t("renderer") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
          "select",
          {
            id: id + "-renderer",
            value: renderer.renderer,
            disabled: !state.allowed,
            "aria-describedby": id + "-renderer-description",
            onChange: (event) => setRenderer(event.target.value),
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "css", children: t("rendererCss") }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "webgl", children: t("rendererWebgl") })
            ]
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { id: id + "-renderer-description", children: t("rendererDescription") }),
        renderer.warning && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-lm-notice", role: "alert", children: t(renderer.warning) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-lm-frame-rate", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { htmlFor: id + "-frame-rate", children: t("frameRate") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "select",
          {
            id: id + "-frame-rate",
            value: rate.frameRate,
            disabled: !state.allowed,
            "aria-describedby": id + "-frame-rate-description",
            onChange: (event) => setFrameRate(Number(event.target.value)),
            children: FRAME_RATES.map((value) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value, children: value === 0 ? t("frameRateDisplay") : value + " FPS" }, value))
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { id: id + "-frame-rate-description", children: t("frameRateDescription") }),
        rate.warning && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-lm-notice", role: "alert", children: t(rate.warning) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-lm-status", role: "status", "aria-live": "polite", "aria-atomic": "true", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-lm-badge", "data-mode": state.mode, children: t(state.mode + "Label") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t(state.mode + "Active") })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-lm-card dsh-lm-fold", "data-allowed": fold.allowed, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-lm-fold-head", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            className: "dsh-lm-checkbox",
            type: "checkbox",
            id: id + "-fold",
            checked: fold.preference,
            disabled: !fold.allowed,
            "aria-describedby": id + "-fold-description" + (!fold.allowed ? " " + id + "-locked" : ""),
            onChange: (event) => setFoldEnabled(event.target.checked)
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { className: "dsh-lm-fold-title", htmlFor: id + "-fold", children: t("foldLabel") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-lm-fold-description", id: id + "-fold-description", children: t("foldDescription") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-lm-status", role: "status", "aria-live": "polite", "aria-atomic": "true", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-lm-badge", "data-fold": fold.enabled, children: t(fold.enabled ? "foldOnLabel" : "foldOffLabel") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t(fold.enabled ? "foldOnActive" : "foldOffActive") })
      ] }),
      fold.warning && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-lm-notice", role: "alert", children: t(fold.warning) })
    ] }),
    !state.allowed && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-lm-notice", id: id + "-locked", children: t("locked") }),
    state.warning && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-lm-notice", role: "alert", children: t(state.warning) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-lm-details", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: t("heading") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { children: DETAILS[state.mode].map((key) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: t(key) }, key)) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: t("unchanged") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-lm-scope", children: t("scope") })
  ] });
}

// src/locale.js
var NS = "web-low-motion";
var en = {
  nav: "Performance",
  title: "Performance",
  description: "Choose how decorative animations use rendering capacity, without changing your conversation.",
  renderer: "Text shimmer renderer",
  rendererCss: "Compositor (default)",
  rendererWebgl: "WebGL GPU (experimental)",
  rendererDescription: "In Optimized mode, try WebGL for text shimmer while keeping its appearance and frame-rate choice. GPU mode may not be faster on your device. Unsupported effects or GPU failures use the compositor automatically; sweeps keep their existing renderer.",
  rendererInvalid: "The saved renderer was invalid. The default compositor is in use.",
  frameRate: "Animation frame rate",
  frameRateDisplay: "Follow display (default)",
  frameRateDescription: "Applies to sweeps and text shimmer in Optimized mode. Limits visual updates while keeping cycle speed and easing. Higher rates use more resources. This does not limit page scrolling or video frame rate.",
  frameRateInvalid: "The saved frame rate was invalid. Following display refresh until a new value is selected.",
  mode: "Animation mode",
  modeDescription: "Changes apply immediately. Use the arrow keys to choose a mode.",
  nativeLabel: "Native",
  optimizedLabel: "Optimized (keep motion)",
  reducedLabel: "Reduced motion",
  recommended: "Recommended",
  nativeDescription: "Use the original DSH animations without overrides.",
  optimizedDescription: "Keep the original sweeps, status dots and horizontal text shimmer. The default for new users.",
  reducedDescription: "Replace decorative running animations with static indicators.",
  nativeActive: "Original DSH animations are in use; no overrides are applied.",
  optimizedActive: "Sweeps, dots and text shimmer keep moving. Offscreen and hidden-page effects pause.",
  reducedActive: "Running indicators are static.",
  scope: "Saved only in this browser. Tabs on the same address stay in sync; other browsers and devices are unaffected.",
  heading: "What changes in this mode",
  nativeDetail: "No animation overrides: DSH controls all original sweeps, status dots and text shimmer.",
  optimizedSweep: "Keep row sweeps moving with transform-based rendering instead of per-frame layout.",
  optimizedDots: "Keep the stepped pixel-chase animation for running status dots.",
  optimizedText: "Keep the original text shimmer colors, direction and speed while reducing repeated rendering work.",
  optimizedPause: "Pause decorative animations when they are offscreen or the page is hidden; resume when visible.",
  systemMotion: "The operating-system reduced-motion preference takes priority.",
  reducedSweep: "Stop the looping tool, reasoning and command sweep effects.",
  reducedDots: "Keep running status dots visible without animation.",
  reducedText: "Use static colors for running and retry status text.",
  unchanged: "Streaming replies, timers, buttons and video playback are unchanged. This does not change the model or its generation speed.",
  locked: "The profile configuration (enabled: false) forces Native mode and disables these choices and the turn-fold switch. Your saved preferences are preserved; enable the plugin in the profile to use them.",
  storage: "Browser storage is unavailable. Changes still apply on this page, but the choice may be lost on refresh.",
  invalid: "The saved preference was invalid. The default preference, Optimized (keep motion), is in use; selecting a mode will replace the saved value.",
  foldLabel: "Automatically fold completed turns",
  foldDescription: "A standalone display preference, independent of the animation mode above. When on, the conversation view collapses turns that have already finished; a turn that is still running or that has no clear boundary is never hidden. When off, the original DSH folding rules apply. This changes only what is displayed, not records, context, or model input.",
  foldOnLabel: "On",
  foldOffLabel: "Off",
  foldOnActive: "Finished turns collapse automatically; running turns stay open.",
  foldOffActive: "The original folding rules apply; this switch adds no folding.",
  foldStorage: "Browser storage is unavailable. The switch still applies on this page, but the fold choice may be lost on refresh.",
  foldInvalid: "The saved fold preference was invalid. The default (on) is in use; toggling the switch will replace the saved value."
};
var zh = {
  nav: "\u6027\u80FD\u4F18\u5316",
  title: "\u6027\u80FD\u4F18\u5316",
  description: "\u9009\u62E9\u88C5\u9970\u6027\u52A8\u6548\u7684\u6E32\u67D3\u65B9\u5F0F\uFF0C\u4E0D\u6539\u53D8\u5BF9\u8BDD\u4F53\u9A8C\u3002",
  renderer: "\u6587\u5B57\u6D41\u5149\u6E32\u67D3",
  rendererCss: "\u5408\u6210\u5C42\uFF08\u9ED8\u8BA4\uFF09",
  rendererWebgl: "WebGL GPU\uFF08\u8BD5\u9A8C\uFF09",
  rendererDescription: "\u5728\u4FDD\u7559\u52A8\u6548\u4F18\u5316\u6A21\u5F0F\u4E0B\uFF0C\u5C1D\u8BD5\u7531 WebGL \u7ED8\u5236\u6587\u5B57\u6D41\u5149\uFF0C\u4FDD\u7559\u5916\u89C2\u5E76\u6CBF\u7528\u4E0B\u65B9\u5E27\u7387\u8BBE\u7F6E\u3002\u662F\u5426\u66F4\u5FEB\u53D6\u51B3\u4E8E\u8BBE\u5907\uFF1B\u4E0D\u652F\u6301\u7684\u6548\u679C\u6216 GPU \u5931\u8D25\u65F6\u81EA\u52A8\u4F7F\u7528\u5408\u6210\u5C42\uFF0C\u626B\u5149\u7EE7\u7EED\u4F7F\u7528\u539F\u6709\u6E32\u67D3\u65B9\u5F0F\u3002",
  rendererInvalid: "\u4FDD\u5B58\u7684\u6E32\u67D3\u65B9\u5F0F\u65E0\u6548\uFF0C\u5DF2\u4F7F\u7528\u9ED8\u8BA4\u5408\u6210\u5C42\u3002",
  frameRate: "\u52A8\u6548\u5E27\u7387",
  frameRateDisplay: "\u8DDF\u968F\u5C4F\u5E55\uFF08\u9ED8\u8BA4\uFF09",
  frameRateDescription: "\u5728\u4FDD\u7559\u52A8\u6548\u7684\u4F18\u5316\u6A21\u5F0F\u4E0B\uFF0C\u63A7\u5236\u626B\u5149\u548C\u6587\u5B57\u6D41\u5149\u7684\u66F4\u65B0\u9891\u7387\uFF0C\u4FDD\u7559\u539F\u6709\u5468\u671F\u548C\u7F13\u52A8\u3002\u5E27\u7387\u8D8A\u9AD8\u5F00\u9500\u8D8A\u5927\uFF1B\u4E0D\u9650\u5236\u9875\u9762\u6EDA\u52A8\u6216\u89C6\u9891\u5E27\u7387\u3002",
  frameRateInvalid: "\u4FDD\u5B58\u7684\u5E27\u7387\u65E0\u6548\uFF0C\u6682\u65F6\u8DDF\u968F\u5C4F\u5E55\uFF1B\u91CD\u65B0\u9009\u62E9\u5373\u53EF\u66FF\u6362\u3002",
  mode: "\u52A8\u6548\u6A21\u5F0F",
  modeDescription: "\u5207\u6362\u540E\u7ACB\u5373\u751F\u6548\uFF0C\u4E5F\u53EF\u4F7F\u7528\u65B9\u5411\u952E\u9009\u62E9\u6A21\u5F0F\u3002",
  nativeLabel: "\u539F\u751F",
  optimizedLabel: "\u4FDD\u7559\u52A8\u6548\u4F18\u5316",
  reducedLabel: "\u4F4E\u52A8\u6001\u6548\u679C",
  recommended: "\u63A8\u8350",
  nativeDescription: "\u4E0D\u8986\u76D6\u4EFB\u4F55\u52A8\u753B\uFF0C\u4F7F\u7528 DSH \u539F\u751F\u52A8\u6548\u3002",
  optimizedDescription: "\u4FDD\u7559\u539F\u6765\u7684\u626B\u5149\u3001\u72B6\u6001\u70B9\u548C\u6A2A\u5411\u6587\u5B57\u6D41\u5149\u3002\u65B0\u7528\u6237\u9ED8\u8BA4\u4F7F\u7528\u6B64\u6A21\u5F0F\u3002",
  reducedDescription: "\u7528\u9759\u6001\u6307\u793A\u4EE3\u66FF\u88C5\u9970\u6027\u8FD0\u884C\u52A8\u753B\u3002",
  nativeActive: "\u4F7F\u7528 DSH \u539F\u751F\u52A8\u6548\uFF0C\u4E0D\u5E94\u7528\u4EFB\u4F55\u52A8\u753B\u8986\u76D6\u3002",
  optimizedActive: "\u626B\u5149\u3001\u72B6\u6001\u70B9\u548C\u6587\u5B57\u6D41\u5149\u7EE7\u7EED\u8FD0\u52A8\uFF1B\u79BB\u5C4F\u6216\u9875\u9762\u9690\u85CF\u65F6\u6682\u505C\u3002",
  reducedActive: "\u8FD0\u884C\u72B6\u6001\u4FDD\u6301\u9759\u6001\u663E\u793A\u3002",
  scope: "\u4EC5\u4FDD\u5B58\u5728\u5F53\u524D\u6D4F\u89C8\u5668\u3002\u540C\u4E00\u5730\u5740\u7684\u6807\u7B7E\u9875\u4F1A\u540C\u6B65\uFF0C\u5176\u4ED6\u6D4F\u89C8\u5668\u548C\u8BBE\u5907\u4E0D\u53D7\u5F71\u54CD\u3002",
  heading: "\u5F53\u524D\u6A21\u5F0F\u7684\u6548\u679C",
  nativeDetail: "\u4E0D\u8986\u76D6\u4EFB\u4F55\u52A8\u753B\uFF1A\u626B\u5149\u3001\u8FD0\u884C\u72B6\u6001\u70B9\u548C\u6587\u5B57\u6D41\u5149\u5747\u7531 DSH \u539F\u751F\u63A7\u5236\u3002",
  optimizedSweep: "\u4FDD\u7559\u5DE5\u5177\u3001\u601D\u8003\u4E0E\u6307\u4EE4\u884C\u7684\u626B\u5149\uFF0C\u6539\u7528 transform \u907F\u514D\u9010\u5E27\u5E03\u5C40\u3002",
  optimizedDots: "\u4FDD\u7559\u8FD0\u884C\u72B6\u6001\u70B9\u7684\u50CF\u7D20\u9636\u68AF\u8FFD\u9010\u52A8\u753B\u3002",
  optimizedText: "\u4FDD\u7559\u6587\u5B57\u6D41\u5149\u7684\u539F\u6709\u914D\u8272\u3001\u65B9\u5411\u4E0E\u901F\u5EA6\uFF0C\u51CF\u5C11\u91CD\u590D\u7ED8\u5236\u5F00\u9500\u3002",
  optimizedPause: "\u88C5\u9970\u6027\u52A8\u753B\u79BB\u5C4F\u6216\u9875\u9762\u9690\u85CF\u65F6\u6682\u505C\uFF0C\u91CD\u65B0\u53EF\u89C1\u540E\u6062\u590D\u3002",
  systemMotion: "\u82E5\u7CFB\u7EDF\u542F\u7528\u4E86\u300C\u51CF\u5C11\u52A8\u6001\u6548\u679C\u300D\uFF0C\u5C06\u4F18\u5148\u9075\u5FAA\u8BE5\u504F\u597D\u3002",
  reducedSweep: "\u5173\u95ED\u5DE5\u5177\u3001\u601D\u8003\u4E0E\u6307\u4EE4\u884C\u7684\u5FAA\u73AF\u626B\u5149\u3002",
  reducedDots: "\u4FDD\u7559\u8FD0\u884C\u72B6\u6001\u70B9\uFF0C\u505C\u6B62\u52A8\u6001\u95EA\u70C1\u3002",
  reducedText: "\u5C06\u8FD0\u884C\u4E0E\u91CD\u8BD5\u72B6\u6001\u6587\u5B57\u6539\u4E3A\u9759\u6001\u989C\u8272\u3002",
  unchanged: "\u4E0D\u5F71\u54CD\u6D41\u5F0F\u56DE\u590D\u3001\u8BA1\u65F6\u3001\u64CD\u4F5C\u6309\u94AE\u548C\u89C6\u9891\u64AD\u653E\uFF0C\u4E5F\u4E0D\u6539\u53D8\u6A21\u578B\u6216\u751F\u6210\u901F\u5EA6\u3002",
  locked: "profile \u914D\u7F6E\u5DF2\u7981\u7528\u63D2\u4EF6\uFF08enabled: false\uFF09\uFF0C\u5F53\u524D\u5F3A\u5236\u4F7F\u7528\u539F\u751F\u6A21\u5F0F\uFF0C\u5E76\u7981\u7528\u4EE5\u4E0A\u9009\u9879\u4E0E\u300C\u81EA\u52A8\u6298\u53E0\u5DF2\u7ED3\u675F\u8F6E\u6B21\u300D\u5F00\u5173\u3002\u5DF2\u4FDD\u5B58\u7684\u504F\u597D\u4FDD\u6301\u4E0D\u53D8\uFF1B\u8BF7\u5148\u5728 profile \u4E2D\u542F\u7528\u63D2\u4EF6\u3002",
  storage: "\u6D4F\u89C8\u5668\u5B58\u50A8\u4E0D\u53EF\u7528\u3002\u5207\u6362\u4ECD\u5728\u672C\u9875\u751F\u6548\uFF0C\u4F46\u5237\u65B0\u540E\u53EF\u80FD\u65E0\u6CD5\u4FDD\u7559\u9009\u62E9\u3002",
  invalid: "\u5DF2\u4FDD\u5B58\u7684\u504F\u597D\u65E0\u6548\uFF0C\u5F53\u524D\u91C7\u7528\u9ED8\u8BA4\u504F\u597D\u300C\u4FDD\u7559\u52A8\u6548\u4F18\u5316\u300D\uFF1B\u9009\u62E9\u6A21\u5F0F\u540E\u4F1A\u91CD\u65B0\u4FDD\u5B58\u3002",
  foldLabel: "\u81EA\u52A8\u6298\u53E0\u5DF2\u7ED3\u675F\u8F6E\u6B21",
  foldDescription: "\u72EC\u7ACB\u4E8E\u4E0A\u65B9\u52A8\u6548\u6A21\u5F0F\u7684\u663E\u793A\u504F\u597D\u3002\u5F00\u542F\u540E\uFF0C\u5BF9\u8BDD\u89C6\u56FE\u4F1A\u6298\u53E0\u5DF2\u7ED3\u675F\u7684\u8F6E\u6B21\uFF1B\u4ECD\u5728\u8FD0\u884C\u6216\u7F3A\u5C11\u660E\u786E\u8FB9\u754C\u7684\u8F6E\u6B21\u4E0D\u4F1A\u88AB\u6298\u53E0\u3002\u5173\u95ED\u540E\u6062\u590D DSH \u539F\u6709\u6298\u53E0\u89C4\u5219\u3002\u4EC5\u6539\u53D8\u663E\u793A\uFF0C\u4E0D\u6539\u52A8\u8BB0\u5F55\u3001\u4E0A\u4E0B\u6587\u6216\u6A21\u578B\u8F93\u5165\u3002",
  foldOnLabel: "\u5DF2\u5F00\u542F",
  foldOffLabel: "\u5DF2\u5173\u95ED",
  foldOnActive: "\u5DF2\u7ED3\u675F\u7684\u8F6E\u6B21\u81EA\u52A8\u6298\u53E0\uFF0C\u8FD0\u884C\u4E2D\u7684\u8F6E\u6B21\u4FDD\u6301\u5C55\u5F00\u3002",
  foldOffActive: "\u4F7F\u7528 DSH \u539F\u6709\u6298\u53E0\u89C4\u5219\uFF0C\u6B64\u5F00\u5173\u4E0D\u989D\u5916\u6298\u53E0\u3002",
  foldStorage: "\u6D4F\u89C8\u5668\u5B58\u50A8\u4E0D\u53EF\u7528\u3002\u5F00\u5173\u4ECD\u5728\u672C\u9875\u751F\u6548\uFF0C\u4F46\u6298\u53E0\u9009\u62E9\u5237\u65B0\u540E\u53EF\u80FD\u65E0\u6CD5\u4FDD\u7559\u3002",
  foldInvalid: "\u5DF2\u4FDD\u5B58\u7684\u6298\u53E0\u504F\u597D\u65E0\u6548\uFF0C\u5F53\u524D\u91C7\u7528\u9ED8\u8BA4\u503C\uFF08\u5F00\u542F\uFF09\uFF1B\u5207\u6362\u5F00\u5173\u540E\u4F1A\u91CD\u65B0\u4FDD\u5B58\u3002"
};

// src/turn-fold-core.js
var TURN_FOLD_KIND = "web-low-motion-turn-fold";
var TURN_FOLD_ANCHOR_OFFSET = -0.05;
var TURN_PROCESS_INDEPENDENT_KINDS = /* @__PURE__ */ new Set([
  "system-prompt",
  "user",
  "steering",
  "turn-process",
  "turn-error",
  "turn-max-tokens",
  "turn-tail"
]);
var DELEGATED_KINDS = Object.freeze({
  "assistant-step": "chat",
  "context": "chat",
  "compaction": "chat",
  "manual-compaction": "chat",
  "model-retry": "chat"
});
var DELEGATED_KIND_LIST = Object.freeze(Object.keys(DELEGATED_KINDS));
var SMOTHER_KIND = "tool-call";
var SHADOW_PRIORITY = -0.5;
function inProcessRange(anchorSeq, spec) {
  if (typeof anchorSeq !== "number" || spec === void 0 || spec === null) return false;
  if (anchorSeq < spec.processStartSeq) return false;
  if (spec.answerAnchorSeq !== null && anchorSeq >= spec.answerAnchorSeq) return false;
  return true;
}
function nodeFoldRole(node, spec) {
  if (node === void 0 || node === null || spec === void 0 || spec === null) return "other";
  if (node.kind === TURN_FOLD_KIND || TURN_PROCESS_INDEPENDENT_KINDS.has(node.kind)) return "independent";
  if (node.kind === "assistant-step" && spec.answerAnchorSeq !== null && spec.answerStep !== null && node.data !== void 0 && node.data !== null && node.data.step === spec.answerStep) return "answer";
  return inProcessRange(node.anchorSeq, spec) ? "process" : "other";
}
function foldGeneration(spec) {
  return spec.answerAnchorSeq === null ? "no-answer" : "answer-" + spec.answerAnchorSeq;
}
function processCounts(spec) {
  const tools = spec.toolCallCount ?? 0;
  const replies = spec.messageCount ?? 0;
  const subagents = spec.subagentCount ?? 0;
  return { tools, replies, subagents, total: tools + replies + subagents };
}
function turnFoldEligible(input) {
  const { enabled: enabled2, nativeFoldable, turnClosed, turnStartSeq, spec } = input;
  if (enabled2 !== true || nativeFoldable === true || turnClosed !== true) return false;
  if (spec === void 0 || spec === null) return false;
  if (typeof turnStartSeq !== "number") return false;
  if (spec.answerAnchorSeq === null) return true;
  return processCounts(spec).total > 0 || spec.inlineReasoning === true;
}
function deriveTurnFold(input) {
  const { enabled: enabled2, nativeFoldable, turnClosed, turnStartSeq, endKind, spec, keys, meta } = input;
  if (!turnFoldEligible({ enabled: enabled2, nativeFoldable, turnClosed, turnStartSeq, spec })) return null;
  if (!Array.isArray(keys) || keys.length === 0 || typeof meta !== "function") return null;
  const processKeys = [];
  const smotherKeys = [];
  const proxyKeys = [];
  let answerKey = null;
  let hasError = false;
  let hasLimit = false;
  for (const key of keys) {
    const item = meta(key);
    if (item === void 0 || item === null) continue;
    if (item.kind === "turn-error") hasError = true;
    else if (item.kind === "turn-max-tokens") hasLimit = true;
    if (item.kind === TURN_FOLD_KIND || TURN_PROCESS_INDEPENDENT_KINDS.has(item.kind)) continue;
    if (item.kind === "assistant-step" && spec.answerAnchorSeq !== null && spec.answerStep !== null && item.step === spec.answerStep) {
      answerKey = key;
      continue;
    }
    if (!inProcessRange(item.anchorSeq, spec)) continue;
    processKeys.push(key);
    if (item.kind === SMOTHER_KIND) smotherKeys.push(key);
    else if (DELEGATED_KINDS[item.kind] !== void 0) proxyKeys.push(key);
  }
  const counts = processCounts(spec);
  const hasFinalAnswer = spec.answerAnchorSeq !== null && spec.answerStep !== null;
  const hasReasoning = spec.inlineReasoning === true;
  if (processKeys.length === 0 && !hasReasoning) return null;
  const reason = !hasFinalAnswer ? hasError || endKind === "error" ? "error" : hasLimit || endKind === "max-tokens" ? "limit" : endKind === "aborted" ? "stopped" : "noAnswer" : counts.total > 0 ? "process" : "reasoning";
  return {
    turn: spec.turn,
    processKeys,
    proxyKeys,
    smotherKeys,
    answerKey,
    processCount: processKeys.length,
    counts,
    hasFinalAnswer,
    inlineReasoning: hasReasoning,
    reason,
    generation: foldGeneration(spec)
  };
}
var planCache = /* @__PURE__ */ new WeakMap();
function planForTurn(input) {
  const { keys, spec, turnClosed, nativeFoldable, enabled: enabled2, turnStartSeq, endKind } = input;
  if (!Array.isArray(keys)) return deriveTurnFold(input);
  const signature = [
    enabled2 === true ? 1 : 0,
    nativeFoldable === true ? 1 : 0,
    turnClosed === true ? 1 : 0,
    typeof turnStartSeq === "number" ? turnStartSeq : "x",
    typeof endKind === "string" ? endKind : "x",
    spec === void 0 || spec === null ? "x" : [spec.controlAnchorSeq, spec.processStartSeq, spec.answerAnchorSeq, spec.answerStep, spec.inlineReasoning ? 1 : 0, spec.messageCount, spec.toolCallCount, spec.subagentCount].join(",")
  ].join("|");
  let bySignature = planCache.get(keys);
  if (bySignature === void 0) {
    bySignature = /* @__PURE__ */ new Map();
    planCache.set(keys, bySignature);
  }
  if (bySignature.has(signature)) return bySignature.get(signature);
  const plan = deriveTurnFold(input);
  bySignature.set(signature, plan);
  return plan;
}
function sameKeyList(left, right) {
  if (left === right) return true;
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
function createTurnFoldStore() {
  const entries = /* @__PURE__ */ new Map();
  const listeners = /* @__PURE__ */ new Map();
  const keyOf = (sessionId, turn) => String(sessionId) + "\0" + String(turn);
  const notify = (key) => {
    const set = listeners.get(key);
    if (set === void 0) return;
    for (const listener of [...set]) listener();
  };
  const read = (sessionId, turn, _generation, fallback) => {
    if (sessionId === void 0 || turn === void 0) return fallback === true;
    const entry = entries.get(keyOf(sessionId, turn));
    if (entry === void 0) return fallback === true;
    return entry.open;
  };
  const write = (sessionId, turn, generation, open, explicit) => {
    if (sessionId === void 0 || turn === void 0) return;
    const key = keyOf(sessionId, turn);
    const entry = entries.get(key);
    if (entry === void 0 && open !== true && explicit !== true) return;
    if (entry !== void 0 && entry.open === (open === true) && entry.explicit === explicit) {
      if (entry.generation !== generation) entries.set(key, { generation, open: entry.open, explicit: entry.explicit });
      return;
    }
    entries.set(key, { generation, open: open === true, explicit });
    notify(key);
  };
  return {
    /**
     * Subscribe to one Turn's manual state.
     * @returns unsubscribe.
     */
    subscribe(sessionId, turn, listener) {
      const key = keyOf(sessionId, turn);
      let set = listeners.get(key);
      if (set === void 0) {
        set = /* @__PURE__ */ new Set();
        listeners.set(key, set);
      }
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(key);
      };
    },
    has(sessionId, turn) {
      if (sessionId === void 0 || turn === void 0) return false;
      return entries.has(keyOf(sessionId, turn));
    },
    /** Whether the reader made an explicit choice in the fallback controller. */
    hasExplicit(sessionId, turn) {
      if (sessionId === void 0 || turn === void 0) return false;
      const entry = entries.get(keyOf(sessionId, turn));
      return entry !== void 0 && entry.explicit === true;
    },
    isOpen(sessionId, turn, generation, fallback = false) {
      return read(sessionId, turn, generation, fallback);
    },
    setOpen(sessionId, turn, generation, open) {
      write(sessionId, turn, generation, open, true);
    },
    mirror(sessionId, turn, generation, open) {
      write(sessionId, turn, generation, open, false);
    },
    clear() {
      if (entries.size === 0) return;
      const keys = [...listeners.keys()];
      for (const entry of entries.values()) void entry;
      entries.clear();
      for (const key of keys) notify(key);
      listeners.clear();
    },
    size() {
      return entries.size;
    }
  };
}
function eventTurn(event) {
  const data = event === void 0 || event === null ? void 0 : event.data;
  return data !== void 0 && data !== null && typeof data.turn === "number" ? data.turn : void 0;
}
function turnLocation(context) {
  const location = context.start?.location ?? context.matches.at(-1)?.location;
  return location !== void 0 && (location.kind === "turn" || location.kind === "step") ? location.turn : void 0;
}
var turnFoldDefinition = {
  kind: TURN_FOLD_KIND,
  target: "chat",
  match(event) {
    if (event.type === "turn/start") return { id: String(event.data.turn), role: "start" };
    if (event.type === "turn/end") {
      const turn = eventTurn(event);
      return turn === void 0 ? null : { id: String(turn), role: "update" };
    }
    return null;
  },
  start(_context, match) {
    if (match.event.type !== "turn/start") throw new Error("turn-fold start requires turn/start");
    return { turn: match.event.data.turn };
  },
  update(context) {
    return context.state;
  },
  publication() {
    return "immediate";
  },
  buildViewNode(context) {
    const turn = turnLocation(context);
    if (turn === void 0 || turn.status !== "closed") return null;
    if (turn.start === void 0) return null;
    const data = turn.data.get("turn-process");
    if (data === void 0 || data === null) return null;
    const authored = data.answerAnchorSeq === null ? true : processCounts(data).total > 0 || data.inlineReasoning === true;
    if (!authored) return null;
    const endReason = turn.end === void 0 || turn.end === null ? void 0 : turn.end.data.reason;
    const endKind = endReason !== void 0 && endReason !== null && typeof endReason.kind === "string" ? endReason.kind : void 0;
    const payload = endKind === void 0 ? data : { ...data, endKind };
    const current = context.current === void 0 ? void 0 : context.current.get("chat");
    if (current !== void 0 && current !== null && current.kind === TURN_FOLD_KIND && (current.data === payload || current.data !== void 0 && current.data !== null && current.data.turn === data.turn && current.data.controlAnchorSeq === data.controlAnchorSeq && current.data.answerAnchorSeq === data.answerAnchorSeq && current.data.endKind === endKind) && current.anchorSeq === data.controlAnchorSeq + TURN_FOLD_ANCHOR_OFFSET) return current;
    return {
      key: context.key,
      kind: TURN_FOLD_KIND,
      id: context.id,
      target: "chat",
      anchorSeq: data.controlAnchorSeq + TURN_FOLD_ANCHOR_OFFSET,
      location: context.start?.location ?? context.matches.at(-1)?.location ?? { kind: "unresolved" },
      visibility: "visible",
      data: payload
    };
  }
};

// src/turn-fold-view.jsx
var import_react2 = require("react");

// src/turn-fold-dom.js
var MARKER = "data-dsh-turn-fold-tool-hidden";
var FLOW = "data-chat-flow";
var FLOW_KEY = "data-chat-flow-key";
var FLOW_KIND = "data-chat-flow-kind";
var FLOW_TURN = "data-chat-turn";
var SLOT = "data-slot";
var SLOT_NODE = "conversation.chat.node";
var CALL_ID = "data-chat-call-id";
var ANCHOR_KEY = "data-chat-anchor-key";
var HIDDEN_UNTIL_FOUND = "until-found";
var FLOW_KIND_TOOL_CALL = "tool-call";
var nextToken = 0;
var columns = /* @__PURE__ */ new WeakMap();
function elementOf(node) {
  return node !== null && typeof node === "object" && node.nodeType === 1 ? (
    /** @type {Element} */
    node
  ) : null;
}
function readFlowKey(element) {
  const value = element.getAttribute(FLOW_KEY);
  return value === null || value === "" ? null : value;
}
function directChild(parent, predicate) {
  const children = parent.children;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child.nodeType === 1 && predicate(child)) return child;
  }
  return null;
}
function slotAnchorOf(seat) {
  return directChild(seat, (child) => child.getAttribute(SLOT) === SLOT_NODE);
}
function rootOf(anchor, callId) {
  const expected = "call:" + callId;
  return directChild(anchor, (child) => child.getAttribute(CALL_ID) === callId && child.getAttribute(ANCHOR_KEY) === expected);
}
function containsActiveElement(root) {
  const doc = root.ownerDocument;
  const active = doc === null ? null : doc.activeElement;
  return active !== null && active !== void 0 && root.contains(active);
}
function createRecord(column) {
  const record = {
    column,
    seats: /* @__PURE__ */ new Map(),
    controllers: /* @__PURE__ */ new Set(),
    targets: /* @__PURE__ */ new Map(),
    targetControllers: /* @__PURE__ */ new Map(),
    keyControllers: /* @__PURE__ */ new Map(),
    observer: null,
    needsRebuild: false,
    flushing: false
  };
  const children = column.children;
  for (let index = 0; index < children.length; index += 1) {
    const child = elementOf(children[index]);
    if (child === null) continue;
    const key = readFlowKey(child);
    if (key !== null) record.seats.set(key, child);
  }
  record.observer = new MutationObserver((mutations) => {
    handleMutations(record, mutations);
  });
  record.observer.observe(column, { childList: true });
  return record;
}
function acquireRecord(column) {
  let record = columns.get(column);
  if (record === void 0) {
    record = createRecord(column);
    columns.set(column, record);
  }
  return record;
}
function releaseRecord(record) {
  if (record.controllers.size > 0) return;
  record.observer.disconnect();
  record.targets.clear();
  record.targetControllers.clear();
  record.keyControllers.clear();
  columns.delete(record.column);
}
function addKeyController(record, key, controller) {
  let set = record.keyControllers.get(key);
  if (set === void 0) {
    set = /* @__PURE__ */ new Set();
    record.keyControllers.set(key, set);
  }
  set.add(controller);
}
function removeKeyController(record, key, controller) {
  const set = record.keyControllers.get(key);
  if (set === void 0) return;
  set.delete(controller);
  if (set.size === 0) record.keyControllers.delete(key);
}
function retainTarget(record, controller, target) {
  const count = record.targets.get(target);
  if (count === void 0) {
    record.targets.set(target, 1);
    record.observer.observe(target, { childList: true });
  } else {
    record.targets.set(target, count + 1);
  }
  let set = record.targetControllers.get(target);
  if (set === void 0) {
    set = /* @__PURE__ */ new Set();
    record.targetControllers.set(target, set);
  }
  set.add(controller);
}
function releaseTarget(record, controller, target) {
  const count = record.targets.get(target);
  if (count === void 0) return;
  const set = record.targetControllers.get(target);
  if (set !== void 0) {
    set.delete(controller);
    if (set.size === 0) record.targetControllers.delete(target);
  }
  if (count <= 1) {
    record.targets.delete(target);
    record.needsRebuild = true;
    return;
  }
  record.targets.set(target, count - 1);
}
function flushTargets(record) {
  if (record.flushing) return;
  record.flushing = true;
  try {
    while (record.needsRebuild) {
      record.needsRebuild = false;
      const pending = record.observer.takeRecords();
      if (pending.length > 0) handleMutations(record, pending);
      record.observer.disconnect();
      record.observer.observe(record.column, { childList: true });
      for (const target of record.targets.keys()) {
        record.observer.observe(target, { childList: true });
      }
    }
  } finally {
    record.flushing = false;
  }
}
function handleMutations(record, mutations) {
  const pending = /* @__PURE__ */ new Set();
  const affectedKeys = /* @__PURE__ */ new Set();
  for (const mutation of mutations) {
    if (mutation.target === record.column) {
      for (const node of mutation.removedNodes) {
        const element = elementOf(node);
        if (element === null) continue;
        const key = readFlowKey(element);
        if (key !== null) {
          if (record.seats.get(key) === element) record.seats.delete(key);
          affectedKeys.add(key);
        }
        const watchers2 = record.targetControllers.get(element);
        if (watchers2 !== void 0) for (const controller of watchers2) pending.add(controller);
      }
      for (const node of mutation.addedNodes) {
        const element = elementOf(node);
        if (element === null) continue;
        const key = readFlowKey(element);
        if (key !== null) {
          record.seats.set(key, element);
          affectedKeys.add(key);
        }
      }
      continue;
    }
    const watchers = record.targetControllers.get(mutation.target);
    if (watchers !== void 0) for (const controller of watchers) pending.add(controller);
  }
  for (const key of affectedKeys) {
    const controllers = record.keyControllers.get(key);
    if (controllers !== void 0) for (const controller of controllers) pending.add(controller);
  }
  for (const controller of pending) controller.reconcile();
  flushTargets(record);
}
var ToolFoldController = class {
  /**
   * @param {Element} column
   * @param {number} turn
   * @param {() => void} reveal
   */
  constructor(column, turn, reveal) {
    nextToken += 1;
    this.token = "dsh-turn-fold-tool-" + nextToken;
    this.column = column;
    this.turnText = String(turn);
    this.reveal = reveal;
    this.nodes = /* @__PURE__ */ new Map();
    this.marks = /* @__PURE__ */ new Map();
    this.watches = /* @__PURE__ */ new Map();
    this.registeredKeys = /* @__PURE__ */ new Set();
    this.collapsed = false;
    this.disposed = false;
    this.reconciling = false;
    this.pendingReconcile = false;
    this.record = acquireRecord(column);
    this.record.controllers.add(this);
  }
  /**
   * @param {{ nodes?: ReadonlyArray<{ key?: unknown, callId?: unknown }>, collapsed: boolean }} input
   */
  update(input) {
    if (this.disposed) return;
    if (input === null || typeof input !== "object") {
      throw new TypeError("turn-fold-dom: update({ nodes, collapsed }) requires an object");
    }
    if (typeof input.collapsed !== "boolean") {
      throw new TypeError("turn-fold-dom: update requires a boolean collapsed");
    }
    const next = /* @__PURE__ */ new Map();
    if (Array.isArray(input.nodes)) {
      for (const item of input.nodes) {
        if (item === null || typeof item !== "object") continue;
        const key = item.key;
        const callId = item.callId;
        if (typeof key !== "string" || key === "") continue;
        if (typeof callId !== "string" || callId === "") continue;
        next.set(key, callId);
      }
    }
    this.nodes = next;
    this.collapsed = input.collapsed;
    this.syncKeyControllers();
    this.reconcile();
    flushTargets(this.record);
  }
  /** Idempotent teardown: drop this Turn's own marks/watch routing and release the shared record. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const key of [...this.marks.keys()]) this.unmark(key);
    this.releaseAllWatches();
    this.unregisterKeys();
    this.record.controllers.delete(this);
    flushTargets(this.record);
    releaseRecord(this.record);
  }
  /** Reentrancy-safe reconcile; a reentrant update is re-run after the current pass. */
  reconcile() {
    if (this.disposed) return;
    if (this.reconciling) {
      this.pendingReconcile = true;
      return;
    }
    this.reconciling = true;
    try {
      do {
        this.pendingReconcile = false;
        this.reconcileOnce();
      } while (this.pendingReconcile && !this.disposed);
    } finally {
      this.reconciling = false;
    }
  }
  /** Route key-level mutations to this controller only while it can hide rows. */
  syncKeyControllers() {
    const desired = this.collapsed ? new Set(this.nodes.keys()) : /* @__PURE__ */ new Set();
    for (const key of desired) {
      if (this.registeredKeys.has(key)) continue;
      this.registeredKeys.add(key);
      addKeyController(this.record, key, this);
    }
    for (const key of [...this.registeredKeys]) {
      if (desired.has(key)) continue;
      this.registeredKeys.delete(key);
      removeKeyController(this.record, key, this);
    }
  }
  /** @param {string} key @returns {Element | undefined} */
  validSeat(key) {
    const seat = this.record.seats.get(key);
    if (seat === void 0) return void 0;
    if (seat.parentElement !== this.column) return void 0;
    if (readFlowKey(seat) !== key) return void 0;
    if (seat.getAttribute(FLOW_KIND) !== FLOW_KIND_TOOL_CALL) return void 0;
    if (seat.getAttribute(FLOW_TURN) !== this.turnText) return void 0;
    return seat;
  }
  /**
   * Keep watches in step with the node list: a known seat/slot anchor stays
   * observed even when its root is absent, so a later insertion is folded.
   */
  syncWatches() {
    const desired = /* @__PURE__ */ new Map();
    if (this.collapsed) {
      for (const key of this.nodes.keys()) {
        const seat = this.validSeat(key);
        if (seat === void 0) continue;
        desired.set(key, { seat, anchor: slotAnchorOf(seat) });
      }
    }
    for (const [key, watch] of [...this.watches]) {
      const next = desired.get(key);
      const same = next !== void 0 && next.seat === watch.seat && next.anchor === watch.anchor;
      if (same) continue;
      this.watches.delete(key);
      releaseTarget(this.record, this, watch.seat);
      if (watch.anchor !== null && watch.anchor !== watch.seat) releaseTarget(this.record, this, watch.anchor);
    }
    for (const [key, watch] of desired) {
      if (this.watches.has(key)) continue;
      retainTarget(this.record, this, watch.seat);
      if (watch.anchor !== null && watch.anchor !== watch.seat) retainTarget(this.record, this, watch.anchor);
      this.watches.set(key, watch);
    }
  }
  reconcileOnce() {
    const desired = /* @__PURE__ */ new Map();
    if (this.collapsed && this.nodes.size > 0) {
      for (const [key, callId] of this.nodes) {
        const seat = this.validSeat(key);
        if (seat === void 0) continue;
        const anchor = slotAnchorOf(seat);
        if (anchor === null) continue;
        const root = rootOf(anchor, callId);
        if (root === null) continue;
        desired.set(key, { seat, anchor, root });
      }
      for (const entry of desired.values()) {
        if (containsActiveElement(entry.root)) {
          this.collapsed = false;
          this.callReveal();
          desired.clear();
          break;
        }
      }
    }
    this.syncWatches();
    for (const key of [...this.marks.keys()]) {
      const keep = desired.get(key);
      const tracked = this.marks.get(key);
      if (keep === void 0 || tracked === void 0 || keep.root !== tracked.root) this.unmark(key);
    }
    for (const [key, entry] of desired) this.mark(key, entry);
    this.syncKeyControllers();
  }
  /**
   * @param {string} key
   * @param {{ root: Element, anchor: Element, seat: Element }} entry
   */
  mark(key, entry) {
    const { root } = entry;
    const tracked = this.marks.get(key);
    if (tracked !== void 0 && tracked.root === root) {
      if (root.getAttribute(MARKER) !== this.token) {
        this.dropMark(key);
        return;
      }
      if (!root.hasAttribute("hidden")) root.setAttribute("hidden", HIDDEN_UNTIL_FOUND);
      return;
    }
    if (tracked !== void 0) this.unmark(key);
    if (root.hasAttribute(MARKER) || root.hasAttribute("hidden")) return;
    root.setAttribute(MARKER, this.token);
    root.setAttribute("hidden", HIDDEN_UNTIL_FOUND);
    const onBeforeMatch = () => {
      this.handleBeforeMatch();
    };
    this.marks.set(key, { root, onBeforeMatch });
    root.addEventListener("beforematch", onBeforeMatch);
  }
  /** Forget a mark whose ownership was taken over, touching no attribute. @param {string} key */
  dropMark(key) {
    const tracked = this.marks.get(key);
    if (tracked === void 0) return;
    this.marks.delete(key);
    tracked.root.removeEventListener("beforematch", tracked.onBeforeMatch);
  }
  /** @param {string} key */
  unmark(key) {
    const tracked = this.marks.get(key);
    if (tracked === void 0) return;
    this.marks.delete(key);
    const { root, onBeforeMatch } = tracked;
    root.removeEventListener("beforematch", onBeforeMatch);
    if (root.getAttribute(MARKER) === this.token) {
      if (root.getAttribute("hidden") === HIDDEN_UNTIL_FOUND) root.removeAttribute("hidden");
      root.removeAttribute(MARKER);
    }
  }
  /** Browser find-in-page reached a folded row: reveal the Turn and let search see it. */
  handleBeforeMatch() {
    if (this.disposed) return;
    this.collapsed = false;
    this.callReveal();
    this.reconcile();
    if (!this.disposed) flushTargets(this.record);
  }
  callReveal() {
    try {
      this.reveal();
    } catch {
    }
  }
  releaseAllWatches() {
    for (const watch of this.watches.values()) {
      releaseTarget(this.record, this, watch.seat);
      if (watch.anchor !== null && watch.anchor !== watch.seat) releaseTarget(this.record, this, watch.anchor);
    }
    this.watches.clear();
  }
  unregisterKeys() {
    for (const key of this.registeredKeys) removeKeyController(this.record, key, this);
    this.registeredKeys.clear();
  }
};
function createToolFoldDOM(options) {
  if (options === null || typeof options !== "object") {
    throw new TypeError("turn-fold-dom: createToolFoldDOM requires { anchor, turn, reveal }");
  }
  const anchor = options.anchor;
  const turn = options.turn;
  const reveal = options.reveal;
  if (anchor === null || typeof anchor !== "object" || typeof anchor.closest !== "function") {
    throw new TypeError("turn-fold-dom: anchor must be an Element");
  }
  if (!Number.isInteger(turn) || turn < 0) {
    throw new TypeError("turn-fold-dom: turn must be a non-negative integer");
  }
  if (typeof reveal !== "function") {
    throw new TypeError("turn-fold-dom: reveal must be a function");
  }
  const column = anchor.closest("[" + FLOW + "]");
  if (column === null || column === void 0) {
    throw new TypeError("turn-fold-dom: anchor is not inside a [" + FLOW + "] column");
  }
  const controller = new ToolFoldController(column, turn, reveal);
  return {
    update(input) {
      controller.update(input);
    },
    dispose() {
      controller.dispose();
    }
  };
}

// src/turn-fold-view.jsx
var import_jsx_runtime2 = require("react/jsx-runtime");
var SLOT2 = "conversation.chat.node";
var readinessColumns = /* @__PURE__ */ new WeakMap();
var readinessKey = (sessionId, turn) => String(sessionId) + "\0" + String(turn);
function readinessRecord(ref, sessionId, turn, create = false) {
  const column = ref.current?.closest("[data-chat-flow]");
  if (!column || sessionId === void 0 || turn === void 0) return void 0;
  let turns = readinessColumns.get(column);
  if (!turns && create) readinessColumns.set(column, turns = /* @__PURE__ */ new Map());
  if (!turns) return void 0;
  const key = readinessKey(sessionId, turn);
  let record = turns.get(key);
  if (!record && create) {
    record = { owners: 0, listeners: /* @__PURE__ */ new Set(), release() {
      if (this.owners === 0 && this.listeners.size === 0) turns.delete(key);
    } };
    turns.set(key, record);
  }
  return record;
}
function retainControl(ref, sessionId, turn) {
  const record = readinessRecord(ref, sessionId, turn, true);
  if (!record) return void 0;
  record.owners += 1;
  if (record.owners === 1) for (const listener of [...record.listeners]) listener();
  return () => {
    record.owners -= 1;
    if (record.owners === 0) for (const listener of [...record.listeners]) listener();
    record.release();
  };
}
function useControlReady(ref, sessionId, turn) {
  return (0, import_react2.useSyncExternalStore)(
    (0, import_react2.useCallback)((listener) => {
      const record = readinessRecord(ref, sessionId, turn, true);
      if (!record) return () => {
      };
      record.listeners.add(listener);
      return () => {
        record.listeners.delete(listener);
        record.release();
      };
    }, [ref, sessionId, turn]),
    (0, import_react2.useCallback)(() => (readinessRecord(ref, sessionId, turn)?.owners ?? 0) > 0, [ref, sessionId, turn])
  );
}
function turnOf(node) {
  const location = node === void 0 ? void 0 : node.location;
  return location !== void 0 && (location.kind === "turn" || location.kind === "step") ? location.turn.turn : void 0;
}
function useOwnSearchableHidden(ref, hidden, reveal) {
  (0, import_react2.useLayoutEffect)(() => {
    const element = ref.current;
    if (element === null) return;
    if (hidden && element.contains(element.ownerDocument.activeElement)) {
      reveal();
      return;
    }
    if (hidden) element.setAttribute("hidden", "until-found");
    else element.removeAttribute("hidden");
  }, [hidden, reveal]);
  (0, import_react2.useEffect)(() => {
    const element = ref.current;
    if (element === null) return;
    element.addEventListener("beforematch", reveal);
    return () => {
      element.removeEventListener("beforematch", reveal);
    };
  }, [hidden, reveal]);
}
function useFoldOpen(store, sessionId, turn, generation) {
  return (0, import_react2.useSyncExternalStore)(
    (0, import_react2.useCallback)((listener) => sessionId === void 0 || turn === void 0 ? () => {
    } : store.subscribe(sessionId, turn, listener), [store, sessionId, turn]),
    (0, import_react2.useCallback)(() => store.isOpen(sessionId, turn, generation, false), [store, sessionId, turn, generation])
  );
}
function useNativeDisclosureBridge(store, sessionId, turn, generation, turnProcess, nativeFoldable) {
  const nativeOpen = turnProcess === void 0 ? void 0 : turnProcess.open;
  const setNativeOpen = turnProcess === void 0 ? void 0 : turnProcess.setOpen;
  (0, import_react2.useEffect)(() => {
    if (!nativeFoldable || sessionId === void 0 || turn === void 0 || setNativeOpen === void 0) return;
    if (store.hasExplicit(sessionId, turn)) {
      const wanted = store.isOpen(sessionId, turn, generation, false);
      if (nativeOpen !== wanted) setNativeOpen(wanted);
      store.mirror(sessionId, turn, generation, wanted);
      return;
    }
    store.mirror(sessionId, turn, generation, nativeOpen === true);
  }, [nativeFoldable, sessionId, turn, generation, nativeOpen, setNativeOpen, store]);
}
function TurnFoldHeader({ plan, open, onToggle, tFold }) {
  const parts = [];
  if (plan.counts.tools > 0) parts.push(tFold(plan.counts.tools === 1 ? "toolOne" : "tools", { count: plan.counts.tools }));
  if (plan.counts.replies > 0) parts.push(tFold(plan.counts.replies === 1 ? "replyOne" : "replies", { count: plan.counts.replies }));
  if (plan.counts.subagents > 0) parts.push(tFold(plan.counts.subagents === 1 ? "subagentOne" : "subagents", { count: plan.counts.subagents }));
  if (parts.length === 0) parts.push(tFold("reasoningOnly"));
  const fullText = [tFold(plan.reason), ...parts].join(" \xB7 ");
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
    "button",
    {
      type: "button",
      className: "dsh-turn-fold-header",
      "data-dsh-turn-fold-header": "",
      "data-open": open || void 0,
      "aria-expanded": open,
      title: fullText,
      "aria-label": fullText + " \u2014 " + tFold(open ? "collapse" : "expand"),
      onClick: (event) => {
        event.currentTarget.focus();
        onToggle();
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dsh-turn-fold-chevron", "aria-hidden": "true" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dsh-turn-fold-title", children: tFold(plan.reason) }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dsh-turn-fold-detail", children: parts.join(" \xB7 ") })
      ]
    }
  );
}
function createProxyView(kind, nativeEntry, store) {
  const Native = nativeEntry.component;
  function TurnFoldProxyView(props) {
    const { node, turnProcess, useChat, sessionId } = props;
    const turn = turnOf(node);
    const status = useChat((snapshot) => turn === void 0 ? void 0 : snapshot.timeline.turns.get(turn)?.status);
    const startSeq = useChat((snapshot) => turn === void 0 ? void 0 : snapshot.timeline.turns.get(turn)?.start?.seq);
    const spec = turnProcess === void 0 ? void 0 : turnProcess.spec;
    const nativeFoldable = turnProcess !== void 0 && turnProcess.foldable === true;
    const generation = spec === void 0 ? "" : foldGeneration(spec);
    const open = useFoldOpen(store, sessionId, turn, generation);
    const contentRef = (0, import_react2.useRef)(null);
    const ready = useControlReady(contentRef, sessionId, turn);
    const eligible = turnFoldEligible({
      enabled: true,
      nativeFoldable,
      turnClosed: status === "closed",
      turnStartSeq: startSeq,
      spec
    });
    const role = spec === void 0 ? "other" : nodeFoldRole(node, spec);
    const collapsed = eligible && ready && role === "process" && !open;
    const reveal = (0, import_react2.useCallback)(() => {
      if (sessionId === void 0 || turn === void 0 || generation === "") return;
      store.setOpen(sessionId, turn, generation, true);
    }, [store, sessionId, turn, generation]);
    useOwnSearchableHidden(contentRef, collapsed, reveal);
    const setOpen = (value) => {
      if (sessionId === void 0 || turn === void 0 || generation === "") return;
      store.setOpen(sessionId, turn, generation, value);
    };
    const delegated = eligible && ready && role === "answer" && spec.inlineReasoning === true ? { ...turnProcess, foldable: true, open, setOpen } : turnProcess;
    return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      "div",
      {
        className: "dsh-turn-fold-node",
        "data-dsh-turn-fold-node": "",
        "data-dsh-turn-fold-state": collapsed ? "collapsed" : "open",
        children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { ref: contentRef, className: "dsh-turn-fold-content", "data-dsh-turn-fold-content": "", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Native, { ...props, turnProcess: delegated }) })
      }
    );
  }
  TurnFoldProxyView.displayName = "TurnFoldProxy(" + kind + ")";
  return TurnFoldProxyView;
}
function createControlView(store, tFold) {
  function TurnFoldControlView(props) {
    const { node, turnProcess, useChat, sessionId } = props;
    const spec = node === void 0 ? void 0 : node.data;
    const turn = spec !== void 0 && typeof spec.turn === "number" ? spec.turn : turnOf(node);
    const snapshotRef = (0, import_react2.useRef)(void 0);
    const keys = useChat((snapshot) => {
      snapshotRef.current = snapshot;
      return turn === void 0 ? void 0 : snapshot.locations.getTurn(turn);
    }, sameKeyList);
    const status = useChat((snapshot) => turn === void 0 ? void 0 : snapshot.timeline.turns.get(turn)?.status);
    const startSeq = useChat((snapshot) => turn === void 0 ? void 0 : snapshot.timeline.turns.get(turn)?.start?.seq);
    const nativeFoldable = turnProcess !== void 0 && turnProcess.foldable === true;
    const plan = (0, import_react2.useMemo)(() => {
      const snapshot = snapshotRef.current;
      if (snapshot === void 0 || keys === void 0 || spec === void 0) return null;
      const meta = (key) => {
        const candidate = snapshot.nodes.get(key);
        if (candidate === void 0 || candidate === null) return void 0;
        const step = candidate.kind === "assistant-step" && candidate.data !== void 0 && candidate.data !== null ? candidate.data.step : void 0;
        return { kind: candidate.kind, anchorSeq: candidate.anchorSeq, step };
      };
      return planForTurn({
        enabled: true,
        nativeFoldable,
        turnClosed: status === "closed",
        turnStartSeq: startSeq,
        endKind: spec.endKind,
        spec,
        keys,
        meta
      });
    }, [keys, status, startSeq, nativeFoldable, spec]);
    const generation = plan !== null ? plan.generation : spec === void 0 ? "" : foldGeneration(spec);
    const open = useFoldOpen(store, sessionId, turn, generation);
    useNativeDisclosureBridge(store, sessionId, turn, generation, turnProcess, nativeFoldable);
    const rootRef = (0, import_react2.useRef)(null);
    (0, import_react2.useLayoutEffect)(() => {
      const owns = plan !== null && !nativeFoldable && turnProcess !== void 0;
      return owns ? retainControl(rootRef, sessionId, turn) : void 0;
    }, [sessionId, turn, plan, nativeFoldable, turnProcess]);
    const reveal = (0, import_react2.useCallback)(() => {
      if (sessionId === void 0 || turn === void 0 || generation === "") return;
      store.setOpen(sessionId, turn, generation, true);
    }, [store, sessionId, turn, generation]);
    const smotherActive = plan !== null && !nativeFoldable && plan.smotherKeys.length > 0 && !open;
    (0, import_react2.useLayoutEffect)(() => {
      const anchor = rootRef.current;
      if (anchor === null || !smotherActive) return void 0;
      let controller;
      try {
        controller = createToolFoldDOM({ anchor, turn, reveal });
      } catch {
        return void 0;
      }
      const snapshot = snapshotRef.current;
      const nodes = plan.smotherKeys.map((key) => {
        const candidate = snapshot === void 0 ? void 0 : snapshot.nodes.get(key);
        const root = candidate === void 0 || candidate.data === void 0 ? void 0 : candidate.data.root;
        if (root === void 0) return void 0;
        if (!("kind" in root)) return void 0;
        return { key, callId: root.callId };
      }).filter((node2) => node2 !== void 0 && node2.callId !== void 0);
      controller.update({ nodes, collapsed: true });
      return () => {
        controller.dispose();
      };
    }, [smotherActive, plan, turn, reveal]);
    if (turnProcess === void 0 || nativeFoldable || plan === null) return null;
    const onToggle = () => {
      if (sessionId === void 0 || turn === void 0) return;
      store.setOpen(sessionId, turn, generation, !open);
    };
    return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      "div",
      {
        ref: rootRef,
        className: "dsh-turn-fold-control",
        "data-dsh-turn-fold-control": "",
        "data-dsh-turn-fold-state": open ? "open" : "collapsed",
        children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(TurnFoldHeader, { plan, open, onToggle, tFold })
      }
    );
  }
  TurnFoldControlView.displayName = "TurnFoldControl";
  return TurnFoldControlView;
}
function asDisposer(value) {
  if (typeof value === "function") return value;
  if (value !== null && typeof value === "object") {
    if (typeof value.dispose === "function") return () => {
      value.dispose();
    };
    if (typeof value[Symbol.dispose] === "function") return () => {
      value[Symbol.dispose]();
    };
  }
  return void 0;
}
var WATCHED_KINDS = [...Object.keys(DELEGATED_KINDS), "tool-call", "turn-process"];
function registerTurnFold(ctx, options) {
  const { store, tFold, definition } = options;
  const slots = ctx.slots;
  const nativeIds = /* @__PURE__ */ new WeakMap();
  const ownComponents = /* @__PURE__ */ new Set();
  let nextNativeId = 0;
  const nativeIdOf = (entry) => {
    let id = nativeIds.get(entry);
    if (id === void 0) {
      id = nextNativeId++;
      nativeIds.set(entry, id);
    }
    return id;
  };
  let disposers = [];
  let diagnostics = [];
  let disposed = false;
  let definitionDispose;
  const ensureDefinition = () => {
    if (definition === void 0 || definitionDispose !== void 0) return;
    definitionDispose = registerTurnFoldDefinition(ctx, definition);
  };
  const dropDefinition = () => {
    if (definitionDispose === void 0) return;
    const dispose = definitionDispose;
    definitionDispose = void 0;
    dispose();
  };
  const disposeAll = () => {
    for (const dispose of disposers.splice(0)) {
      try {
        dispose();
      } catch {
      }
    }
  };
  const rosterOf = () => {
    try {
      return [...slots.entries(SLOT2)];
    } catch {
      return null;
    }
  };
  const foreignFor = (roster, kind) => roster.find((entry) => entry.options.key === kind && (entry.options.priority ?? 0) !== 0 && !ownComponents.has(entry.component));
  const signatureOf = (roster) => {
    if (roster === null) return "unavailable";
    const parts = [];
    for (const kind of WATCHED_KINDS) {
      const sameKey = roster.filter((entry) => entry.options.key === kind);
      const native = sameKey.find((entry) => (entry.options.priority ?? 0) === 0);
      const foreign = foreignFor(roster, kind);
      parts.push(kind + ":" + (native === void 0 ? "-" : nativeIdOf(native)) + ":" + (foreign === void 0 ? "-" : String(foreign.options.priority ?? 0)));
    }
    return parts.join("|");
  };
  const register = (kind, priority, component, locale) => {
    ownComponents.add(component);
    try {
      disposers.push(slots.inject(SLOT2, () => slots.register({
        name: SLOT2,
        key: kind,
        priority,
        ...locale === void 0 ? {} : { locale }
      }, component)));
      return true;
    } catch (error) {
      diagnostics.push({ kind, code: "register-failed", message: String(error && error.message) });
      return false;
    }
  };
  const evaluate = () => {
    disposeAll();
    diagnostics = [];
    const roster = rosterOf();
    if (roster === null) {
      diagnostics.push({ kind: "*", code: "roster-unavailable" });
      return;
    }
    let occupied = false;
    for (const kind of WATCHED_KINDS) {
      const foreign = foreignFor(roster, kind);
      if (foreign !== void 0) {
        diagnostics.push({ kind, code: "occupied", priority: foreign.options.priority ?? 0 });
        occupied = true;
      }
    }
    if (occupied) {
      dropDefinition();
      return;
    }
    for (const kind of Object.keys(DELEGATED_KINDS)) {
      const sameKey = roster.filter((entry) => entry.options.key === kind);
      const native = sameKey.find((entry) => (entry.options.priority ?? 0) === 0);
      if (native === void 0) {
        diagnostics.push({ kind, code: "missing-native" });
        continue;
      }
      let priority = SHADOW_PRIORITY;
      while (sameKey.some((entry) => (entry.options.priority ?? 0) === priority)) priority -= 1;
      register(kind, priority, createProxyView(kind, native, store), DELEGATED_KINDS[kind]);
    }
    const controlRegistered = register(TURN_FOLD_KIND, 0, createControlView(store, tFold));
    if (controlRegistered) ensureDefinition();
    else dropDefinition();
  };
  const report = () => {
    if (diagnostics.length > 0 && typeof console !== "undefined" && console.warn) {
      console.warn("dsh-web-low-motion: turn-fold registration notes", diagnostics);
    }
  };
  evaluate();
  report();
  let signature = signatureOf(rosterOf());
  let unsubscribe;
  if (typeof slots.subscribe === "function") {
    let scheduled = false;
    unsubscribe = slots.subscribe(SLOT2, () => {
      if (disposed || scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        if (disposed) return;
        const next = signatureOf(rosterOf());
        if (next === signature) return;
        signature = next;
        evaluate();
        report();
      });
    });
  }
  return {
    get diagnostics() {
      return diagnostics;
    },
    dispose() {
      disposed = true;
      if (typeof unsubscribe === "function") unsubscribe();
      unsubscribe = void 0;
      disposeAll();
      dropDefinition();
    }
  };
}
function registerTurnFoldDefinition(ctx, definition) {
  if (typeof ctx.inject === "function") {
    let disposed = false;
    let fiber;
    try {
      fiber = ctx.inject(["uiConversation"], (scope) => {
        if (disposed) return () => {
        };
        const off = scope.uiConversation.events.register(definition);
        const dispose = asDisposer(off);
        return () => {
          if (dispose !== void 0) dispose();
        };
      });
    } catch (error) {
      if (typeof console !== "undefined" && console.warn) {
        console.warn("dsh-web-low-motion: uiConversation injection failed", error);
      }
      return void 0;
    }
    return () => {
      if (disposed) return;
      disposed = true;
      if (fiber !== null && typeof fiber === "object" && typeof fiber.dispose === "function") {
        try {
          fiber.dispose();
        } catch {
        }
        return;
      }
      Promise.resolve(fiber).then(
        (value) => {
          const dispose = asDisposer(value);
          if (dispose !== void 0) dispose();
        },
        () => {
        }
      );
    };
  }
  const uiConversation = typeof ctx.get === "function" ? ctx.get("uiConversation") : void 0;
  if (uiConversation === void 0 || uiConversation === null || uiConversation.events === void 0) {
    if (typeof console !== "undefined" && console.warn) {
      console.warn("dsh-web-low-motion: uiConversation service unavailable; turn-fold control rows disabled");
    }
    return void 0;
  }
  return asDisposer(uiConversation.events.register(definition));
}

// src/turn-fold-locale.js
var TURN_FOLD_NAMESPACE = "web-low-motion-turn-fold";
var en2 = {
  expand: "Expand this finished turn",
  collapse: "Collapse this finished turn",
  process: "Finished turn",
  reasoning: "Finished turn \xB7 final answer kept",
  stopped: "Stopped without a final answer",
  noAnswer: "Ended without a final answer",
  error: "Ended with an error \xB7 no final answer",
  limit: "Stopped at the limit \xB7 no final answer",
  toolOne: "1 tool call",
  tools: "{count} tool calls",
  replyOne: "1 earlier reply",
  replies: "{count} earlier replies",
  subagentOne: "1 subagent",
  subagents: "{count} subagents",
  reasoningOnly: "reasoning only",
  region: "Finished turn process"
};
var zh2 = {
  expand: "\u5C55\u5F00\u672C\u8F6E\u5DF2\u7ED3\u675F\u7684\u8FC7\u7A0B",
  collapse: "\u6536\u8D77\u672C\u8F6E\u5DF2\u7ED3\u675F\u7684\u8FC7\u7A0B",
  process: "\u5DF2\u7ED3\u675F\u7684\u8F6E\u6B21",
  reasoning: "\u5DF2\u7ED3\u675F \xB7 \u4FDD\u7559\u6700\u7EC8\u6B63\u6587",
  stopped: "\u5DF2\u505C\u6B62 \xB7 \u6CA1\u6709\u6700\u7EC8\u56DE\u7B54",
  noAnswer: "\u7ED3\u675F\u65F6\u6CA1\u6709\u6700\u7EC8\u56DE\u7B54",
  error: "\u51FA\u9519\u7ED3\u675F \xB7 \u6CA1\u6709\u6700\u7EC8\u56DE\u7B54",
  limit: "\u8FBE\u5230\u4E0A\u9650\u505C\u6B62 \xB7 \u6CA1\u6709\u6700\u7EC8\u56DE\u7B54",
  toolOne: "1 \u6B21\u5DE5\u5177\u8C03\u7528",
  tools: "{count} \u6B21\u5DE5\u5177\u8C03\u7528",
  replyOne: "1 \u6761\u4E2D\u95F4\u56DE\u590D",
  replies: "{count} \u6761\u4E2D\u95F4\u56DE\u590D",
  subagentOne: "1 \u4E2A\u5B50\u4EE3\u7406",
  subagents: "{count} \u4E2A\u5B50\u4EE3\u7406",
  reasoningOnly: "\u4EC5\u601D\u8003",
  region: "\u5DF2\u7ED3\u675F\u8F6E\u6B21\u7684\u8FC7\u7A0B"
};

// src/low-motion.css
var low_motion_default = '/* Match semantic attributes, never CSS-Module hashes or translated text.\n   Suppress only pseudo-element animation/gradients: preserve solid status dots,\n   disclosure glyphs, controls, finite notifications and user-rendered media. */\n[data-chat-flow] [data-state="running"]::after,\n[data-chat-flow] [data-state="running"] *::after {\n  animation: none !important;\n  background-image: none !important;\n}\n\n/* The shared ongoing matrix also occurs in sidebars and background-job rows. */\nsvg[data-state="ongoing"] rect {\n  animation: none !important;\n  opacity: 1 !important;\n}\n\n/* A Turn status is a direct flow child; retry status lives in its disclosure.\n   Do not select every role=status: toast entry/exit animations must finish. */\n[data-chat-flow] > [role="status"][aria-live="polite"],\n[data-chat-flow] details[data-active] > summary > [role="status"] {\n  animation: none !important;\n  background: none !important;\n  background-clip: border-box !important;\n  -webkit-background-clip: border-box !important;\n  -webkit-text-fill-color: currentColor !important;\n}\n\n[data-chat-flow] > [role="status"][aria-live="polite"] {\n  color: var(--dsw-alias-state-business-primary, currentColor) !important;\n}\n\n[data-chat-flow] details[data-active] > summary > [role="status"] {\n  color: var(--dsw-alias-label-secondary, currentColor) !important;\n}\n';

// src/settings.css
var settings_default = "/* Plugin-local classes and native controls use the host theme tokens. */\n.dsh-lm-page { display: grid; gap: 24px; width: 100%; color: var(--dsw-alias-label-primary); }\n.dsh-lm-page h2 { margin: 0; font-size: 22px; line-height: 30px; font-weight: 600; }\n.dsh-lm-page p { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 21px; }\n.dsh-lm-page .dsh-lm-description { margin-top: 8px; }\n.dsh-lm-card { min-width: 0; padding: 20px; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 14px; background: var(--dsw-alias-bg-base); }\n.dsh-lm-control { min-inline-size: 0; margin: 0; padding: 0; border: 0; }\n.dsh-lm-label { padding: 0; font-size: 15px; font-weight: 500; line-height: 24px; margin-bottom: 4px; }\n.dsh-lm-options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 16px; }\n.dsh-lm-option { display: flex; align-items: flex-start; gap: 10px; min-width: 0; padding: 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; cursor: pointer; }\n.dsh-lm-control:not(:disabled) .dsh-lm-option:hover { background: var(--dsw-alias-interactive-bg-hover); }\n.dsh-lm-option[data-selected='true'] { border-color: var(--dsw-alias-state-business-primary); background: var(--dsw-alias-state-business-tertiary); }\n.dsh-lm-radio { flex: 0 0 auto; width: 16px; height: 16px; margin: 3px 0 0; accent-color: var(--dsw-alias-state-business-primary); cursor: inherit; }\n.dsh-lm-radio:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 3px; }\n.dsh-lm-option:focus-within { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }\n.dsh-lm-option-content { display: grid; gap: 6px; min-width: 0; overflow-wrap: anywhere; }\n.dsh-lm-option-title { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 14px; font-weight: 500; line-height: 22px; }\n.dsh-lm-option-description { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 20px; }\n.dsh-lm-recommended { padding: 0 6px; border-radius: 5px; color: var(--dsw-alias-state-business-primary); background: var(--dsw-alias-state-business-tertiary); font-size: 11px; font-weight: 500; line-height: 20px; }\n.dsh-lm-control:disabled .dsh-lm-option { cursor: not-allowed; opacity: 0.6; }\n.dsh-lm-status { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-top: 18px; font-size: 12px; line-height: 20px; color: var(--dsw-alias-label-secondary); }\n.dsh-lm-badge { padding: 2px 9px; border-radius: 999px; corner-shape: round; background: var(--dsw-alias-interactive-bg-hover); }\n.dsh-lm-badge[data-mode='optimized'], .dsh-lm-badge[data-mode='reduced'] { color: var(--dsw-alias-state-business-primary); background: var(--dsw-alias-state-business-tertiary); }\n.dsh-lm-details h3 { margin: 0; font-size: 14px; line-height: 24px; font-weight: 500; }\n.dsh-lm-details ul { padding-left: 20px; margin: 10px 0 14px; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 26px; }\n.dsh-lm-page .dsh-lm-scope { padding-top: 16px; border-top: 0.5px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-tertiary); font-size: 12px; }\n.dsh-lm-page .dsh-lm-notice { color: var(--dsw-alias-state-warn-label); }\n.dsh-lm-fold-head { display: flex; align-items: center; gap: 10px; }\n.dsh-lm-checkbox { flex: 0 0 auto; width: 16px; height: 16px; margin: 0; accent-color: var(--dsw-alias-state-business-primary); cursor: pointer; }\n.dsh-lm-checkbox:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 3px; }\n.dsh-lm-checkbox:disabled { cursor: not-allowed; }\n.dsh-lm-fold-title { font-size: 15px; font-weight: 500; line-height: 24px; cursor: pointer; }\n.dsh-lm-fold[data-allowed='false'] .dsh-lm-fold-title { cursor: not-allowed; opacity: 0.6; }\n.dsh-lm-page .dsh-lm-fold-description { margin-top: 6px; }\n.dsh-lm-fold .dsh-lm-status { margin-top: 12px; }\n.dsh-lm-badge[data-fold='true'] { color: var(--dsw-alias-state-business-primary); background: var(--dsw-alias-state-business-tertiary); }\n@media (max-width: 640px) {\n  .dsh-lm-options { grid-template-columns: minmax(0, 1fr); }\n}\n\n.dsh-lm-frame-rate { display: grid; grid-template-columns: 1fr auto; gap: 10px; margin-top: 20px; align-items: center; }\n.dsh-lm-frame-rate > p { grid-column: 1 / -1; }\n.dsh-lm-frame-rate select { padding: 6px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; color: inherit; background: var(--dsw-alias-bg-base); }\n";

// src/turn-fold.css
var turn_fold_default = `/* Turn-fold: one control row per finished Turn the shipped controller left
   unfolded, plus the searchable hidden containers that own folded content. The
   shipped seat's own [hidden] attribute is never written here. */

.dsh-turn-fold-control,
.dsh-turn-fold-node {
  display: flex;
  flex-direction: column;
  min-width: 0;
  max-width: 100%;
}

.dsh-turn-fold-header {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--dsw-alias-label-secondary, #9ca3af);
  font: inherit;
  font-size: 14px;
  line-height: 24px;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
  text-align: left;
}

.dsh-turn-fold-header:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #2d4bd2);
  outline-offset: 1px;
  border-radius: 4px;
}

.dsh-turn-fold-chevron {
  flex: none;
  width: 14px;
  height: 14px;
  position: relative;
}

.dsh-turn-fold-chevron::before {
  content: "";
  position: absolute;
  inset: 3px 2px 3px 4px;
  border-top: 1.5px solid currentColor;
  border-right: 1.5px solid currentColor;
  transform: rotate(45deg) scale(0.72);
  transform-origin: center;
}

.dsh-turn-fold-header[data-open] .dsh-turn-fold-chevron::before {
  transform: rotate(135deg) scale(0.72);
}

.dsh-turn-fold-title {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-turn-fold-detail {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-tertiary, #6b7280);
}

.dsh-turn-fold-content {
  min-width: 0;
}

/* Collapsed rows keep their content searchable (hidden="until-found"), so the
   shipped column's sibling margin would otherwise leave a 16px gap where a row
   no longer paints. Cancel only that row's own margin, on the strict
   seat -> renderer outlet -> tool-root path; the next visible row keeps its
   separation and a row that still shows a control header keeps its margin. */
[data-chat-flow] > [data-chat-flow-key]:has(> [data-slot="conversation.chat.node"] > [data-dsh-turn-fold-tool-hidden]) {
  margin-top: 0 !important;
}

[data-chat-flow] > [data-chat-flow-key]:has(> [data-slot="conversation.chat.node"] > [data-dsh-turn-fold-node][data-dsh-turn-fold-state="collapsed"]):not(:has([data-dsh-turn-fold-header])) {
  margin-top: 0 !important;
}
`;

// src/client.js
var name = "web-low-motion";
var inject = ["slots", "locale"];
function apply(ctx, config) {
  const allowed = enabled(config);
  const state = (0, import_dsh_client_store.createSnapshotStore)({ preference: "optimized", mode: allowed ? "optimized" : "native", allowed, warning: null });
  const preference = createPreferences(state, () => window.localStorage, allowed);
  const rendererState = (0, import_dsh_client_store.createSnapshotStore)({ renderer: "css", warning: null });
  const rendererPreference = createRendererPreferences(rendererState, () => window.localStorage, allowed);
  const frameRateState = (0, import_dsh_client_store.createSnapshotStore)({ frameRate: 0, warning: null });
  const frameRatePreference = createFrameRatePreferences(frameRateState, () => window.localStorage, allowed);
  const foldState = (0, import_dsh_client_store.createSnapshotStore)({ preference: true, enabled: allowed, allowed, warning: null });
  const foldPreference = createFoldPreferences(foldState, () => window.localStorage, allowed);
  const foldStore = createTurnFoldStore();
  ctx.effect(() => ctx.locale.register(NS, { en, zh }));
  ctx.effect(() => ctx.locale.register(TURN_FOLD_NAMESPACE, { en: en2, zh: zh2 }));
  const t = ctx.locale.bind(NS);
  const tFold = ctx.locale.bind(TURN_FOLD_NAMESPACE);
  ctx.effect(() => {
    const style = document.createElement("style");
    style.dataset.plugin = "dsh-web-low-motion";
    style.dataset.dshLowMotion = "";
    style.textContent = low_motion_default;
    const settings = document.createElement("style");
    settings.dataset.plugin = "dsh-web-low-motion";
    settings.dataset.dshLowMotionSettings = "";
    settings.textContent = settings_default;
    document.head.append(settings);
    let appliedMode = "native";
    let stopOptimized;
    const sync = () => {
      const mode = state.getSnapshot().mode;
      if (mode === appliedMode) {
        stopOptimized?.setFrameRate(frameRateState.getSnapshot().frameRate);
        stopOptimized?.setRenderer(rendererState.getSnapshot().renderer);
        return;
      }
      stopOptimized?.();
      stopOptimized = void 0;
      style.remove();
      appliedMode = mode;
      if (mode === "reduced") document.head.append(style);
      else if (mode === "optimized") stopOptimized = mountOptimized(document, window, frameRateState.getSnapshot().frameRate, rendererState.getSnapshot().renderer);
    };
    const unsubscribe = state.subscribe(sync);
    const unsubscribeRenderer = rendererState.subscribe(sync);
    const unsubscribeFrameRate = frameRateState.subscribe(sync);
    const onStorage = (event) => {
      if (event.key === RENDERER_KEY || event.key === null) {
        try {
          if (event.storageArea === window.localStorage) rendererPreference.restore();
        } catch {
        }
      }
      if (event.key === FRAME_RATE_KEY || event.key === null) {
        try {
          if (event.storageArea === window.localStorage) frameRatePreference.restore();
        } catch {
        }
      }
      if (event.key !== STORAGE_KEY && event.key !== LEGACY_STORAGE_KEY && event.key !== null) return;
      try {
        if (event.storageArea !== window.localStorage) return;
      } catch {
        return;
      }
      preference.restore();
    };
    window.addEventListener("storage", onStorage);
    sync();
    return () => {
      unsubscribe();
      unsubscribeFrameRate();
      unsubscribeRenderer();
      window.removeEventListener("storage", onStorage);
      stopOptimized?.();
      style.remove();
      settings.remove();
    };
  });
  ctx.effect(() => {
    const style = document.createElement("style");
    style.dataset.plugin = "dsh-web-low-motion";
    style.dataset.dshTurnFold = "";
    style.textContent = turn_fold_default;
    let registration;
    let registered = false;
    const enable = () => {
      if (registered) return;
      registered = true;
      document.head.append(style);
      registration = registerTurnFold(ctx, { store: foldStore, tFold, definition: turnFoldDefinition });
    };
    const disable = () => {
      if (!registered) return;
      registered = false;
      registration?.dispose();
      registration = void 0;
      style.remove();
      foldStore.clear();
    };
    const sync = () => {
      if (foldState.getSnapshot().enabled) enable();
      else disable();
    };
    const unsubscribe = foldState.subscribe(sync);
    const onStorage = (event) => {
      if (event.key !== FOLD_STORAGE_KEY && event.key !== null) return;
      try {
        if (event.storageArea !== window.localStorage) return;
      } catch {
        return;
      }
      foldPreference.restore();
    };
    window.addEventListener("storage", onStorage);
    sync();
    return () => {
      unsubscribe();
      window.removeEventListener("storage", onStorage);
      disable();
    };
  });
  ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section",
    id: "web-low-motion",
    order: 40,
    label: () => t("nav"),
    locale: NS,
    inject: () => ({
      hooks: { lowMotion: state, turnFold: foldState, frameRate: frameRateState, shimmerRenderer: rendererState },
      setMode: preference.setMode,
      setFrameRate: frameRatePreference.setFrameRate,
      setRenderer: rendererPreference.setRenderer,
      setFoldEnabled: foldPreference.setEnabled
    })
  }, SettingsPage));
}
return module.exports;}});
//# sourceMappingURL=client.js.map
