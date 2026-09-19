/** A small WebGL2 surface behind the existing CSS glyph mask.
 * Only reviewed horizontal sRGB gradients are accepted. Unknown colors/geometry,
 * unavailable contexts and lost contexts leave the CSS renderer usable.
 */
const hubs = new WeakMap();
function hubFor(win) {
  let hub = hubs.get(win);
  if (hub) return hub;
  const active = new Set();
  let handle = null;
  const tick = () => {
    handle = null;
    for (const item of [...active]) item.draw();
    if (active.size) handle = win.requestAnimationFrame(tick);
  };
  hub = { contexts: 0, add(item) { active.add(item); if (handle === null) handle = win.requestAnimationFrame(tick); },
    remove(item) { active.delete(item); if (!active.size && handle !== null) { win.cancelAnimationFrame(handle); handle = null; } } };
  hubs.set(win, hub); return hub;
}

export function parseGradient(text) {
  // Computed legacy rgb()/rgba() colors use sRGB interpolation. Other spaces
  // retain the browser renderer instead of silently changing their colors.
  const match = /^linear-gradient\(90deg,\s*(.*)\)$/.exec(text);
  if (!match) return null;
  const tokens = match[1].match(/rgba?\([^)]*\)(?:\s+[\d.]+%)?/g);
  if (!tokens || tokens.length < 2 || tokens.length > 8
    || match[1].replace(/rgba?\([^)]*\)(?:\s+[\d.]+%)?/g, '').replace(/[\s,]/g, '')) return null;
  const stops = tokens.map(token => {
    const m = /^rgba?\(([^)]+)\)(?:\s+([\d.]+)%)?$/.exec(token);
    const values = m[1].split(',').map(Number);
    if (![3, 4].includes(values.length) || !values.every(Number.isFinite)
      || values.slice(0, 3).some(n => n < 0 || n > 255) || (values[3] !== undefined && (values[3] < 0 || values[3] > 1))) return null;
    const alpha = values[3] ?? 1;
    return { color: [...values.slice(0, 3).map(n => n / 255 * alpha), alpha], at: m[2] === undefined ? null : Number(m[2]) / 100 };
  });
  if (stops.some(s => !s)) return null;
  stops[0].at ??= 0; stops.at(-1).at ??= 1;
  let previous = 0;
  for (const stop of stops) if (stop.at !== null) {
    if (stop.at < previous || stop.at > 1) return null;
    previous = stop.at;
  }
  for (let i = 1; i < stops.length - 1; i++) if (stops[i].at === null) {
    let end = i; while (stops[end].at === null) end++;
    const start = i - 1;
    for (let j = i; j < end; j++) stops[j].at = stops[start].at + (stops[end].at - stops[start].at) * (j - start) / (end - start);
    i = end - 1;
  }
  return stops;
}

const vertex = `#version 300 es
out vec2 uv;
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);uv=p;gl_Position=vec4(p*2.-1.,0,1);}`;
const fragment = `#version 300 es
precision highp float;
in vec2 uv;uniform float phase;uniform float scale;
uniform vec4 colors[8];uniform float stops[8];uniform int count;out vec4 color;
void main(){float x=(uv.x+(scale-1.)*phase)/scale;vec4 c=colors[0];
for(int i=1;i<8;i++){if(i>=count)break;float span=stops[i]-stops[i-1];
float t=span==0.?step(stops[i],x):clamp((x-stops[i-1])/span,0.,1.);c=mix(c,colors[i],t);}color=c;}`;

export function createGradientRenderer(canvas, win, onFailure) {
  const hub = hubFor(win);
  // Leave context headroom for Endfield, videos and other tabs.
  if (hub.contexts >= 4) return null;
  let gl, program, probe, effect, configured, phaseLocation;
  const shaders = [];
  let disposed = false, paused = true, counted = false, lastSample = null, signature = '';
  let maxSize = 0;
  function dispose() {
    if (disposed) return;
    disposed = true; hub.remove(item); canvas.removeEventListener('webglcontextlost', lost);
    probe?.cancel();
    if (gl) {
      if (program) gl.deleteProgram(program);
      for (const shader of shaders) gl.deleteShader(shader);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
    if (counted) { counted = false; hub.contexts--; }
  }
  function lost(event) { event.preventDefault(); dispose(); onFailure(); }
  function draw() {
    if (disposed || !configured) return;
    try {
      const { animation, duration, frameRate, from, to } = configured;
      const time = ((animation.currentTime ?? 0) % duration + duration) % duration;
      const count = frameRate ? Math.max(1, Math.min(2048, Math.floor(duration * frameRate / 1000))) : 0;
      const sample = count ? Math.floor(time / duration * count) * duration / count : time;
      if (lastSample === sample) return;
      probe.currentTime = sample;
      const progress = effect.getComputedTiming().progress;
      if (progress === null) return;
      gl.uniform1f(phaseLocation, from + (to - from) * progress);
      gl.drawArrays(gl.TRIANGLES, 0, 3); lastSample = sample;
    } catch { dispose(); onFailure(); }
  }
  const item = { draw };
  try {
    gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false,
      depth: false, stencil: false, preserveDrawingBuffer: false });
    if (!gl) return null;
    counted = true; hub.contexts++;
    canvas.addEventListener('webglcontextlost', lost);
    for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
      const shader = gl.createShader(type); if (!shader) throw Error('Shader allocation');
      shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error('Shader compilation');
    }
    program = gl.createProgram(); if (!program) throw Error('Program allocation');
    for (const shader of shaders) gl.attachShader(program, shader);
    gl.linkProgram(program); if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error('Program link');
    maxSize = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
    gl.useProgram(program); phaseLocation = gl.getUniformLocation(program, 'phase');
  } catch { dispose(); return null; }
  return {
    update(next) {
      if (disposed) return false;
      const stops = parseGradient(next.gradient);
      if (!stops || !(next.width > 0 && next.height > 0 && next.scale > 1 && next.duration > 0) || !next.animation) return false;
      try {
        const key = [next.gradient, next.width, next.height, next.dpr, next.scale].join('|');
        if (signature !== key) {
          const width = Math.ceil(next.width * next.dpr), height = Math.ceil(next.height * next.dpr);
          if (width > maxSize || height > maxSize) return false;
          canvas.width = width; canvas.height = height; gl.viewport(0, 0, width, height);
          const colors = new Float32Array(32), points = new Float32Array(8);
          stops.forEach((s, i) => { colors.set(s.color, i * 4); points[i] = s.at; });
          gl.uniform4fv(gl.getUniformLocation(program, 'colors'), colors);
          gl.uniform1fv(gl.getUniformLocation(program, 'stops'), points);
          gl.uniform1i(gl.getUniformLocation(program, 'count'), stops.length);
          gl.uniform1f(gl.getUniformLocation(program, 'scale'), next.scale);
          signature = key; lastSample = null;
        }
        if (!configured || configured.duration !== next.duration || configured.easing !== next.easing) {
          probe?.cancel();
          effect = new win.KeyframeEffect(null, [], { duration: next.duration, easing: next.easing, fill: 'both' });
          probe = new win.Animation(effect, null); lastSample = null;
        }
        if (configured?.frameRate !== next.frameRate) lastSample = null;
        configured = next;
        if (!paused) draw(); return !disposed;
      } catch { return false; }
    },
    setPaused(value) {
      if (disposed || paused === value) return;
      paused = value;
      if (paused) hub.remove(item); else { draw(); if (!disposed) hub.add(item); }
    },
    dispose,
  };
}
