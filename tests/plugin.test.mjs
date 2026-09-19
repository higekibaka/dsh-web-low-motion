import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { enabled } from '../src/config.js';
import { apply as hostApply } from '../src/index.js';

const fixture = await readFile(new URL('./activity.html', import.meta.url), 'utf8');
const bundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

async function openPage(t, mode = 'reduced') {
  const page = await browser.newPage({ reducedMotion: 'no-preference' });
  t.after(() => page.close());
  await page.route('http://plugin.test/', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  await page.goto('http://plugin.test/');
  await page.evaluate(mode => { if (mode !== null) localStorage.setItem('dsh-web-low-motion.mode.v2', mode); }, mode);
  await page.evaluate(() => {
    window.__ModuleLoader__ = { load({ id, factory }) {
      if (id !== 'dsh-web-low-motion') throw new Error('Unexpected module id');
      window.plugin = factory(id => {
        if (id === '@deepseek-ai/dsh-client-store') return { createSnapshotStore(initial) {
          let state = initial;
          const listeners = new Set();
          return { getSnapshot: () => state, set(next) { state = next; for (const listener of listeners) listener(); },
            subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
        } };
        if (id === 'react/jsx-runtime') return { jsx() {}, jsxs() {} };
        if (id === 'react') return { useId() { return 'test-radio'; } };
        if (id === '@deepseek-ai/dsh-client-ui-primitives') return { Switch() {} };
        throw new Error('Unexpected platform import: ' + id);
      });
    } };
    window.disposers = [];
    window.mount = (config = {}) => window.plugin.apply({
      effect(fn) { window.disposers.push(fn()); },
      locale: { register() { return () => {}; }, bind() { return key => key; } },
      slots: {
        inject(_name, fn) { window.disposers.push(fn()); },
        register(spec) { window.settings = spec.inject(); return () => { delete window.settings; }; },
      },
    }, config);
    window.unmount = () => { for (const dispose of window.disposers.splice(0)) dispose(); };
  });
  await page.addScriptTag({ content: bundle });
  return page;
}

async function frames(page, count) {
  await page.evaluate(async (count) => {
    for (let i = 0; i < count; i++) await new Promise(resolve => requestAnimationFrame(resolve));
  }, count);
}

async function layouts(cdp, page) {
  await frames(page, 4);
  const before = await cdp.send('Performance.getMetrics');
  await frames(page, 30);
  const after = await cdp.send('Performance.getMetrics');
  const count = result => result.metrics.find(metric => metric.name === 'LayoutCount').value;
  return count(after) - count(before);
}

test('config is explicit and Host companion makes no service mutations', () => {
  assert.equal(enabled(), true);
  assert.equal(enabled({ enabled: false }), false);
  for (const value of [null, [], true, { enabled: 'false' }, { unsupported: true }]) {
    assert.throws(() => enabled(value), TypeError);
  }
  hostApply(new Proxy({}, { get() { throw new Error('Host services must not be accessed'); } }), {});
});

test('profile-disabled plugin keeps settings but applies no motion override; invalid config fails loudly', async (t) => {
  const page = await openPage(t);
  await page.evaluate(() => window.mount({ enabled: false }));
  assert.equal(await page.locator('style[data-dsh-low-motion]').count(), 0);
  assert.equal(await page.evaluate(() => window.settings.hooks.lowMotion.getSnapshot().allowed), false);
  await page.evaluate(() => window.settings.setMode('optimized'));
  assert.equal(await page.locator('style[data-dsh-low-motion]').count(), 0);
  await assert.rejects(page.evaluate(() => window.mount({ enabled: 'false' })), /boolean/);
});

test('removes recurring layout, preserves controls, and restores original styles on dispose', async (t) => {
  const page = await openPage(t);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  assert.ok(await layouts(cdp, page) > 0, 'stock sweep must demonstrate the layout workload');
  await page.evaluate(() => window.mount());
  assert.equal(await layouts(cdp, page), 0);
  const state = await page.evaluate(() => {
    const sweep = getComputedStyle(document.querySelector('.row-a1'), '::after');
    const dot = getComputedStyle(document.querySelector('.dot-c3'), '::after');
    const matrix = getComputedStyle(document.querySelector('rect'));
    return { sweep: sweep.animationName, glare: sweep.backgroundImage, dot: dot.backgroundColor,
      matrix: matrix.animationName, opacity: matrix.opacity, toast: getComputedStyle(document.querySelector('.toast-f6')).animationName };
  });
  assert.deepEqual(state, { sweep: 'none', glare: 'none', dot: 'rgb(0, 128, 0)', matrix: 'none', opacity: '1', toast: 'toast-in, toast-fade' });
  await page.evaluate(() => {
    document.querySelector('#stop').addEventListener('click', () => { document.querySelector('#stream').textContent += ' stopped'; });
  });
  await page.locator('#stop').click();
  assert.equal(await page.locator('#stream').textContent(), 'Streaming text stopped');
  assert.equal(await page.locator('video').count(), 1);
  await page.evaluate(() => window.unmount());
  assert.equal(await page.locator('style[data-dsh-low-motion]').count(), 0);
  assert.equal(await page.locator('.row-a1').evaluate(e => getComputedStyle(e, '::after').animationName), 'dsh-tool-row-sweep');
  await page.evaluate(() => { window.mount(); window.unmount(); });
  assert.equal(await page.locator('style[data-dsh-low-motion]').count(), 0);
});

test('later rows and later stylesheets are covered without a DOM observer', async (t) => {
  const page = await openPage(t);
  await page.evaluate(() => window.mount());
  await page.evaluate(() => {
    const row = document.createElement('div');
    row.className = 'shell-b2'; row.dataset.state = 'running'; row.id = 'later';
    document.querySelector('[data-chat-flow]').append(row);
  });
  await page.addStyleTag({ content: '.shell-b2::after { animation: dsh-tool-row-sweep 2.6s infinite; }' });
  assert.equal(await page.locator('#later').evaluate(e => getComputedStyle(e, '::after').animationName), 'none');
});

test('static status and retry text keep theme colors in light and dark mode', async (t) => {
  const page = await openPage(t);
  await page.evaluate(() => window.mount());
  for (const [accent, foreground, surface] of [['rgb(45, 75, 210)', 'rgb(70, 70, 80)', 'white'], ['rgb(130, 160, 255)', 'rgb(220, 220, 230)', 'black']]) {
    const colors = await page.evaluate(({ accent, foreground, surface }) => {
      const root = document.documentElement;
      root.style.setProperty('--dsw-alias-state-business-primary', accent);
      root.style.setProperty('--dsw-alias-label-secondary', foreground);
      root.style.setProperty('--surface', surface);
      return ['#turn-status', '.retry-e5'].map(selector => {
        const style = getComputedStyle(document.querySelector(selector));
        return { color: style.color, fill: style.webkitTextFillColor, animation: style.animationName, background: style.backgroundImage };
      });
    }, { accent, foreground, surface });
    assert.deepEqual(colors, [accent, foreground].map(color => ({ color, fill: color, animation: 'none', background: 'none' })));
  }
});


test('optimized sweep keeps its motion and 300px geometry without per-frame layout', async (t) => {
  const page = await openPage(t, null);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  assert.equal(await page.evaluate(() => [...document.styleSheets[0].cssRules].find(r => r.style?.animationName === 'dsh-tool-row-sweep').style.backgroundImage), '', 'native CSS-variable shorthand must exercise deferred expansion');
  const native = await page.locator('.row-a1').evaluate(element => {
    const css = getComputedStyle(element, '::after');
    return { background: css.backgroundImage, duration: css.animationDuration, easing: css.animationTimingFunction };
  });
  assert.ok(await layouts(cdp, page) > 0);
  await page.evaluate(() => window.mount());
  assert.equal(await page.evaluate(() => window.settings.hooks.lowMotion.getSnapshot().mode), 'optimized');
  assert.equal(await page.locator('style[data-dsh-motion-optimized]').getAttribute('data-native-sweeps'), '1');
  assert.equal(await layouts(cdp, page), 0);
  const moving = () => page.locator('.row-a1').evaluate(e => getComputedStyle(e, '::after').transform);
  const a = await moving();
  await frames(page, 4);
  assert.notEqual(await moving(), a, 'the optimized sweep must still move');
  const actual = await page.locator('.row-a1').evaluate(element => {
    const css = getComputedStyle(element, '::after');
    return { background: css.backgroundImage, duration: css.animationDuration, easing: css.animationTimingFunction };
  });
  assert.deepEqual(actual, native);
  for (const width of [180, 720]) {
    const endpoints = await page.locator('.row-a1').evaluate((element, width) => {
      element.style.width = width + 'px';
      const animation = element.getAnimations({ subtree: true }).find(a => a.animationName === 'dsh-lm-sweep-transform');
      animation.pause();
      const left = () => {
        const css = getComputedStyle(element, '::after');
        return parseFloat(css.left) + new DOMMatrixReadOnly(css.transform).m41;
      };
      animation.currentTime = 0;
      const start = left();
      animation.currentTime = 2340;
      const end = left();
      animation.currentTime = 2590;
      return { start, end, hold: left(), width: element.clientWidth, band: getComputedStyle(element, '::after').backgroundSize };
    }, width);
    assert.equal(endpoints.start, -300);
    assert.ok(Math.abs(endpoints.end - endpoints.width) < .1);
    assert.equal(endpoints.hold, endpoints.end);
    assert.equal(endpoints.band, '300px 100%');
  }
  assert.equal(await page.locator('#turn-status [data-dsh-lm-band]').evaluate(e => getComputedStyle(e).animationName), 'dsh-lm-shimmer-translate');
  assert.equal(await page.locator('.retry-e5 [data-dsh-lm-band]').evaluate(e => getComputedStyle(e).animationName), 'dsh-lm-shimmer-translate');
  const opacity = await page.locator('rect').first().evaluate(element => {
    const animation = element.getAnimations()[0];
    animation.pause();
    return [124.9, 125, 250, 375].map(time => { animation.currentTime = time; return Number(getComputedStyle(element).opacity); });
  });
  assert.deepEqual(opacity, [1, .6, .35, .15]);
  assert.equal(await page.locator('.dot-c3').evaluate(e => getComputedStyle(e, '::after').animationName), 'none');
});

test('all three modes switch live and optimized disposal restores untouched native styles', async (t) => {
  const page = await openPage(t, 'optimized');
  const original = await page.locator('style[data-plugin-css]').textContent();
  await page.evaluate(() => window.mount());
  await page.locator('[data-dsh-lm-observed]').first().waitFor();
  await page.evaluate(() => window.settings.setMode('native'));
  assert.equal(await page.locator('style[data-dsh-motion-optimized],style[data-dsh-low-motion],[data-dsh-lm-observed],[data-dsh-lm-paused]').count(), 0);
  assert.equal(await page.locator('.row-a1').evaluate(e => getComputedStyle(e, '::after').animationName), 'dsh-tool-row-sweep');
  await page.evaluate(() => window.settings.setMode('reduced'));
  assert.equal(await page.locator('.row-a1').evaluate(e => getComputedStyle(e, '::after').animationName), 'none');
  await page.evaluate(() => window.settings.setMode('optimized'));
  assert.equal(await page.locator('.row-a1').evaluate(e => getComputedStyle(e, '::after').animationName), 'dsh-lm-sweep-transform');
  await page.evaluate(() => window.unmount());
  assert.equal(await page.locator('style[data-plugin="dsh-web-low-motion"],[data-dsh-lm-observed],[data-dsh-lm-paused],html[data-dsh-lm-hidden]').count(), 0);
  assert.equal(await page.locator('style[data-plugin-css]').textContent(), original);
});

test('animated status text avoids continuous main-thread style work and preserves live text and media', async (t) => {
  const page = await openPage(t, 'optimized');
  // Isolate text animation: an otherwise idle status must not schedule a style
  // update every display frame, even while it continues to look animated.
  await page.addStyleTag({ content: '.row-a1::after,.shell-b2::after,svg rect,.toast-f6{animation:none!important}' });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  async function styleUpdates() {
    // rAF sampling itself forces main-thread animation/style updates. Measure
    // without injecting a per-frame callback into the page being profiled.
    await page.waitForTimeout(250);
    const before = await cdp.send('Performance.getMetrics');
    await page.waitForTimeout(600);
    const after = await cdp.send('Performance.getMetrics');
    const value = result => result.metrics.find(metric => metric.name === 'RecalcStyleCount').value;
    return value(after) - value(before);
  }
  assert.ok(await styleUpdates() >= 15, 'native text shimmer exercises main-thread style work');
  const original = await page.locator('#turn-status').evaluate(e => ({ text: e.textContent, gradient: getComputedStyle(e).backgroundImage, width: e.getBoundingClientRect().width }));
  await page.evaluate(() => window.mount());
  const optimizedUpdates = await styleUpdates();
  assert.ok(optimizedUpdates <= 2, `compositor text animation must not recalculate style continuously (${optimizedUpdates} updates)`);
  const moving = () => page.locator('#turn-status [data-dsh-lm-band]').evaluate(e => getComputedStyle(e).transform);
  const transform = await moving();
  await frames(page, 9);
  assert.notEqual(await moving(), transform, 'the original horizontal shimmer still moves');
  assert.deepEqual(await page.locator('#turn-status').evaluate(e => ({ text: e.textContent, gradient: getComputedStyle(e).backgroundImage, width: e.getBoundingClientRect().width })), original);
  await page.evaluate(() => {
    const clock = document.createElement('span'); clock.id = 'clock'; clock.textContent = '1s';
    document.querySelector('#turn-status').append(clock);
    clock.textContent = '2s';
    document.querySelector('.retry-e5').textContent = 'Retrying in 1 second';
    document.querySelector('#stream').textContent += ' next token';
  });
  assert.equal(await page.locator('#clock').textContent(), '2s');
  assert.equal(await page.locator('.retry-e5').textContent(), 'Retrying in 1 second');
  assert.equal(await page.locator('#stream').textContent(), 'Streaming text next token');
  assert.equal(await page.locator('#media').evaluate(e => getComputedStyle(e).animationName), 'none');
  await page.evaluate(() => window.settings.setMode('native'));
  assert.equal(await page.locator('#turn-status').evaluate(e => getComputedStyle(e).animationName), 'shimmer');
  assert.equal(await page.locator('#turn-status').evaluate(e => getComputedStyle(e).opacity), '1');
});

test('offscreen and hidden-page effects pause then resume without stopping text updates', async (t) => {
  const page = await openPage(t, 'optimized');
  await page.evaluate(() => window.mount());
  await frames(page, 6);
  await page.locator('#tool').evaluate(e => { e.style.cssText = 'position:fixed;top:-500px'; });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.row-a1'), '::after').animationPlayState === 'paused');
  await frames(page, 3);
  const time = () => page.locator('.row-a1').evaluate(e => e.getAnimations({ subtree: true }).find(a => a.animationName === 'dsh-lm-sweep-transform').currentTime);
  const held = await time();
  await frames(page, 6);
  assert.equal(await time(), held);
  await page.locator('#tool').evaluate(e => { e.style.cssText = ''; });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.row-a1'), '::after').animationPlayState === 'running');
  await frames(page, 4);
  assert.ok(await time() > held);
  // Drive the visibility event deterministically; actual tab scheduling is browser-owned.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    document.querySelector('#stream').textContent += ' next token';
  });
  assert.equal(await page.locator('#turn-status [data-dsh-lm-band]').evaluate(e => getComputedStyle(e).animationPlayState), 'paused');
  assert.equal(await page.locator('#stream').textContent(), 'Streaming text next token');
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  assert.equal(await page.locator('#turn-status [data-dsh-lm-band]').evaluate(e => getComputedStyle(e).animationPlayState), 'running');
});

test('new rows are optimized and detached paused rows release their observer without watching streamed DOM', async (t) => {
  const page = await openPage(t, 'optimized');
  await page.evaluate(() => {
    window.observed = new Set();
    const IO = window.IntersectionObserver;
    window.IntersectionObserver = class extends IO {
      observe(element) { window.observed.add(element); return super.observe(element); }
      unobserve(element) { window.observed.delete(element); return super.unobserve(element); }
      disconnect() { window.observed.clear(); return super.disconnect(); }
    };
    window.mutationRoots = [];
    window.headCallbacks = 0;
    const MO = window.MutationObserver;
    window.MutationObserver = class extends MO {
      constructor(callback) { super((...args) => { window.headCallbacks++; callback(...args); }); }
      observe(element, options) { window.mutationRoots.push({ tag: element.tagName, status: element.getAttribute('role') === 'status', options }); return super.observe(element, options); }
    };
    window.mount();
  });
  await frames(page, 5);
  const callbacks = await page.evaluate(() => window.headCallbacks);
  await page.evaluate(() => {
    const text = document.querySelector('#stream').firstChild;
    for (let i = 0; i < 1000; i++) text.appendData('x');
    const row = document.createElement('div');
    row.className = 'shell-b2'; row.dataset.state = 'running'; row.id = 'late';
    row.style.cssText = 'position:fixed;top:-500px'; row.textContent = 'Later';
    document.querySelector('[data-chat-flow]').append(row);
    window.late = row;
  });
  await page.waitForFunction(() => window.observed.has(window.late) && window.late.hasAttribute('data-dsh-lm-paused'));
  assert.equal(await page.locator('#late').evaluate(e => getComputedStyle(e, '::after').animationName), 'dsh-lm-sweep-transform');
  assert.equal(await page.evaluate(() => window.headCallbacks), callbacks);
  assert.ok(await page.evaluate(() => window.mutationRoots.every(({tag,status,options}) =>
    tag === 'HEAD' || status || (['HTML','BODY'].includes(tag) && options.attributes && !options.subtree && !options.childList))),
  'only status subtrees, stylesheet registration and root theme attributes are observed');
  await page.evaluate(() => window.late.remove());
  await page.waitForFunction(() => !window.observed.has(window.late));
  await page.evaluate(() => { document.querySelector('#tool').dataset.state = 'done'; });
  await page.waitForFunction(() => !window.observed.has(document.querySelector('.row-a1')));
  await page.evaluate(() => window.unmount());
  assert.equal(await page.evaluate(() => window.observed.size), 0);
});


test('late native styles are discovered, unsupported geometry is left native, and removal restores observers', async (t) => {
  const page = await openPage(t, 'optimized');
  await page.evaluate(() => {
    window.mount();
    const row = document.createElement('div');
    row.id = 'future'; row.className = 'future'; row.dataset.state = 'running';
    row.textContent = 'Future native row';
    document.querySelector('[data-chat-flow]').append(row);
    const style = document.createElement('style');
    style.dataset.pluginCss = '@deepseek-ai/dsh-client-ui-chat/ReasoningRow.module.css';
    style.textContent = '.future{position:relative;overflow:hidden;width:300px;height:24px}'
      + '.future[data-state="running"]::after{content:"";position:absolute;top:0;bottom:0;width:301px;'
      + 'background:linear-gradient(90deg,transparent,white,transparent);animation:dsh-reasoning-row-sweep 2.6s ease-out infinite}'
      + '@keyframes dsh-reasoning-row-sweep{0%{left:-300px}90%,100%{left:100%}}';
    document.head.append(style);
    window.futureStyle = style;
  });
  await frames(page, 4);
  assert.equal(await page.locator('#future').evaluate(e => getComputedStyle(e, '::after').animationName), 'dsh-reasoning-row-sweep');
  await page.evaluate(() => { window.futureStyle.textContent = window.futureStyle.textContent.replace('width:301px', 'width:300px'); });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#future'), '::after').animationName === 'dsh-lm-sweep-transform');
  assert.equal(await page.locator('style[data-dsh-motion-optimized]').getAttribute('data-native-sweeps'), '2');
  await page.evaluate(() => window.futureStyle.remove());
  await page.waitForFunction(() => document.querySelector('style[data-dsh-motion-optimized]').dataset.nativeSweeps === '1');
  assert.equal(await page.locator('#future').getAttribute('data-dsh-lm-observed'), null);
});

test('optimized mode preserves pixel phase offsets and honors the operating-system reduced-motion preference', async (t) => {
  const page = await openPage(t, 'optimized');
  await page.locator('rect').evaluate(e => { e.style.animationDelay = '-125ms'; });
  await page.evaluate(() => window.mount());
  const phase = await page.locator('rect').evaluate(element => {
    const animation = element.getAnimations()[0];
    animation.pause(); animation.currentTime = 0;
    const style = getComputedStyle(element);
    return { delay: style.animationDelay, opacity: Number(style.opacity) };
  });
  assert.deepEqual(phase, { delay: '-0.125s', opacity: .6 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('.row-a1').evaluate(e => getComputedStyle(e, '::after').animationName), 'none');
  assert.equal(await page.locator('#turn-status').evaluate(e => getComputedStyle(e).animationName), 'none');
  assert.equal(await page.locator('.retry-e5').evaluate(e => getComputedStyle(e).animationName), 'none');
  assert.equal(await page.locator('rect').evaluate(e => getComputedStyle(e).animationName), 'none');
  assert.equal(await page.locator('rect').evaluate(e => getComputedStyle(e).opacity), '1');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert.equal(await page.locator('.row-a1').evaluate(e => getComputedStyle(e, '::after').animationName), 'dsh-lm-sweep-transform');
});


test('mixed real-element selectors and ambiguous keyframes remain native', async (t) => {
  for (const kind of ['mixed', 'duplicate']) {
    const page = await openPage(t, 'optimized');
    await page.evaluate(kind => {
      window.mount();
      const element = document.createElement('div'); element.className = 'plain'; element.textContent = 'Native'; document.body.append(element);
      const style = document.createElement('style');
      style.dataset.pluginCss = '@deepseek-ai/dsh-client-ui-tool/bash-sample.module.css';
      const selector = kind === 'mixed' ? '.plain, .plain::after' : '.plain::after';
      style.textContent = selector + '{content:"";position:absolute;top:0;bottom:0;width:300px;'
        + 'background:linear-gradient(90deg,transparent,white,transparent);animation:dsh-bash-row-sweep 2.6s ease-out infinite}'
        + '@keyframes dsh-bash-row-sweep{0%{left:-300px}90%,100%{left:100%}}'
        + (kind === 'duplicate' ? '@keyframes dsh-bash-row-sweep{0%{left:-600px}100%{left:200%}}' : '');
      document.head.append(style);
    }, kind);
    await frames(page, 4);
    assert.equal(await page.locator('.plain').evaluate(e => getComputedStyle(e, '::after').animationName), 'dsh-bash-row-sweep');
    if (kind === 'mixed') assert.equal(await page.locator('.plain').evaluate(e => getComputedStyle(e).width), '300px');
  }
});

test('static reduced-motion targets are not retained and stopped animations are unobserved', async (t) => {
  const page = await openPage(t, 'optimized');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('svg').evaluate(e => { e.style.cssText = 'position:fixed;top:-500px'; });
  await page.evaluate(() => window.mount());
  assert.equal(await page.locator('svg').getAttribute('data-dsh-lm-observed'), null);
  assert.equal(await page.locator('.row-a1').getAttribute('data-dsh-lm-observed'), null);
  await page.locator('svg').evaluate(e => e.remove());
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForFunction(() => document.querySelector('.row-a1').hasAttribute('data-dsh-lm-observed'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => !document.querySelector('.row-a1').hasAttribute('data-dsh-lm-observed'));
});

test('original shimmer geometry, easing, clock, theme and font size survive caching', async (t) => {
  const page = await openPage(t, 'optimized');
  await page.addStyleTag({content: `
    .status-d4 { font: 600 14px/22px sans-serif; height:26px; align-items:center; white-space:nowrap;
      background:linear-gradient(90deg,var(--accent,#4168da) 40%,#cadbff 50%,var(--accent,#4168da) 60%);
      background-clip:text;background-size:250% 100%;background-position:100% 0;
      animation:real-shimmer 1.8s linear infinite; }
    @keyframes real-shimmer {to{background-position:0 0}}
    #clock {margin-left:8px;font:400 13px/20px sans-serif;color:rgb(80,80,80);-webkit-text-fill-color:rgb(80,80,80)}
  `});
  const native = await page.locator('#turn-status').evaluate(e => {
    const clock=document.createElement('span');clock.id='clock';clock.textContent='16s';e.append(clock);
    const css=getComputedStyle(e);return {width:e.getBoundingClientRect().width,gradient:css.backgroundImage};
  });
  await page.evaluate(() => window.mount());
  await page.waitForFunction(() => document.querySelector('#turn-status').hasAttribute('data-dsh-lm-shimmer'));
  const actual=await page.locator('#turn-status').evaluate(e=>{
    const band=e.querySelector('[data-dsh-lm-band]');const animation=band.getAnimations()[0];animation.pause();
    const points=[0,900,1799.9].map(t=>{animation.currentTime=t;return new DOMMatrixReadOnly(getComputedStyle(band).transform).m41});
    return {width:e.getBoundingClientRect().width,gradient:getComputedStyle(band).backgroundImage,
      bandWidth:band.getBoundingClientRect().width,points,duration:animation.effect.getTiming().duration,
      easing:animation.effect.getKeyframes()[0].easing,clock:getComputedStyle(document.querySelector('#clock')).webkitTextFillColor};
  });
  assert.equal(actual.width,native.width);
  assert.equal(actual.gradient,native.gradient);
  assert.ok(Math.abs(actual.bandWidth/native.width-2.5)<.01);
  assert.ok(Math.abs(actual.points[0]+native.width*1.5)<.1);
  assert.ok(Math.abs(actual.points[1]+native.width*.75)<.1);
  assert.ok(Math.abs(actual.points[2])<.1);
  assert.equal(actual.duration,1800);assert.equal(actual.easing,'linear');assert.equal(actual.clock,'rgb(80, 80, 80)');
  await page.locator('#turn-status [data-dsh-lm-band]').evaluate(e=>{e.getAnimations()[0].currentTime=1200});
  await page.evaluate(()=>{
    document.querySelector('#clock').textContent='17s';
    document.documentElement.style.setProperty('--accent','#90aaff');
    document.querySelector('#turn-status').style.fontSize='20px';
    document.querySelector('.retry-e5').textContent='Retrying in 1 second';
  });
  await page.waitForFunction(()=>{
    const e=document.querySelector('#turn-status');
    return e.hasAttribute('data-dsh-lm-shimmer') && decodeURIComponent(e.querySelector('[data-dsh-lm-glyphs]').style.maskImage).includes('17s');
  });
  assert.match(await page.locator('#turn-status [data-dsh-lm-band]').evaluate(e=>getComputedStyle(e).backgroundImage), /144, 170, 255/);
  assert.match(await page.locator('#turn-status [data-dsh-lm-glyphs]').evaluate(e=>decodeURIComponent(e.style.maskImage)), /font-size: 20px/);
  assert.ok(await page.locator('#turn-status [data-dsh-lm-band]').evaluate(e=>e.getAnimations()[0].currentTime >= 1200), 'clock changes preserve shimmer phase');
  assert.equal(await page.locator('#clock').textContent(),'17s');
  assert.equal(await page.locator('.retry-e5').textContent(),'Retrying in 1 second');
  await page.evaluate(()=>window.unmount());
  assert.equal(await page.locator('[data-dsh-lm-glyphs],[data-dsh-lm-shimmer]').count(),0);
  assert.equal(await page.locator('#turn-status').evaluate(e=>getComputedStyle(e).animationPlayState),'running');
});

test('complex status markup falls back to native rendering and returns when supported', async(t)=>{
  const page=await openPage(t,'optimized');await page.evaluate(()=>window.mount());
  await page.waitForFunction(()=>document.querySelector('#turn-status').hasAttribute('data-dsh-lm-shimmer'));
  await page.evaluate(()=>{document.querySelector('#turn-status').innerHTML='<strong>New custom status</strong>'});
  await page.waitForFunction(()=>!document.querySelector('#turn-status').hasAttribute('data-dsh-lm-shimmer'));
  assert.equal(await page.locator('#turn-status').evaluate(e=>getComputedStyle(e).animationPlayState),'running');
  assert.equal(await page.locator('#turn-status').textContent(),'New custom status');
  await page.evaluate(()=>{document.querySelector('#turn-status').textContent='Deep diving again'});
  await page.waitForFunction(()=>document.querySelector('#turn-status').hasAttribute('data-dsh-lm-shimmer'));
  assert.equal(await page.locator('#turn-status').textContent(),'Deep diving again');
});

test('frame cap preserves shimmer phase, period, mask and easing samples; follow-display restores native easing', async t => {
  const page = await openPage(t, 'optimized');
  await page.evaluate(() => window.mount());
  await page.waitForFunction(() => document.querySelector('#turn-status').hasAttribute('data-dsh-lm-shimmer'));
  const result = await page.evaluate(() => {
    const band = document.querySelector('#turn-status [data-dsh-lm-band]');
    const glyphs = band.parentElement;
    const animation = band.getAnimations()[0]; animation.pause(); animation.currentTime = 500;
    const original = animation.effect.getKeyframes()[0].easing;
    const mask = glyphs.style.maskImage, duration = animation.effect.getTiming().duration;
    window.settings.setFrameRate(30);
    const capped = band.getAnimations()[0];
    const phase = capped.currentTime, easing = capped.effect.getKeyframes()[0].easing;
    const unique = new Set();
    for (let t = 0; t < 1800; t += 1) { capped.currentTime = t; unique.add(getComputedStyle(band).transform); }
    const keyframe = new KeyframeEffect(null, [], { duration: 1800, easing: original, fill: 'both' });
    const probe = new Animation(keyframe, null);
    let error = 0;
    const sample = new Animation(new KeyframeEffect(null, [], { duration: 1800, easing, fill: 'both' }), null);
    for (let t = 0; t < 1800; t += 53) {
      sample.currentTime = t;
      probe.currentTime = Math.floor(t / (1800 / 54)) * (1800 / 54);
      error = Math.max(error, Math.abs(sample.effect.getComputedTiming().progress - keyframe.getComputedTiming().progress));
    }
    sample.cancel(); probe.cancel();
    capped.currentTime = 900;
    window.settings.setFrameRate(0);
    return { phase, unique: unique.size, error, easing, original,
      restored: band.getAnimations()[0].effect.getKeyframes()[0].easing,
      finalPhase: band.getAnimations()[0].currentTime,
      sameMask: mask === glyphs.style.maskImage, duration,
      saved: localStorage.getItem('dsh-web-low-motion.frame-rate.v1') };
  });
  assert.equal(result.phase, 500); assert.equal(result.finalPhase, 900);
  assert.equal(result.duration, 1800); assert.equal(result.sameMask, true);
  assert.match(result.easing, /^linear\(/); assert.equal(result.restored, result.original);
  assert.ok(result.unique <= 55 && result.unique >= 52, JSON.stringify(result));
  assert.ok(result.error < .00001, JSON.stringify(result)); assert.equal(result.saved, '0');
});

test('frame caps affect sweep updates only in optimized mode and survive remount and storage pushes', async t => {
  const page = await openPage(t, 'optimized');
  await page.evaluate(() => { window.mount(); window.settings.setFrameRate(24); });
  const sweep = () => page.locator('.row-a1').evaluate(e => getComputedStyle(e, '::after').animationTimingFunction);
  assert.match(await sweep(), /^linear\(/);
  await page.evaluate(() => { window.unmount(); window.mount(); });
  assert.equal(await page.evaluate(() => window.settings.hooks.frameRate.getSnapshot().frameRate), 24);
  await page.evaluate(() => window.settings.setMode('native'));
  assert.equal(await sweep(), 'ease-out');
  await page.evaluate(() => {
    localStorage.setItem('dsh-web-low-motion.frame-rate.v1', '60');
    window.dispatchEvent(new StorageEvent('storage', { key: 'dsh-web-low-motion.frame-rate.v1', storageArea: localStorage }));
    window.settings.setMode('optimized');
  });
  assert.equal(await page.evaluate(() => window.settings.hooks.frameRate.getSnapshot().frameRate), 60);
  assert.match(await sweep(), /^linear\(/);
  await page.evaluate(() => window.unmount());
  assert.equal(await sweep(), 'ease-out');
  assert.equal(await page.locator('[data-dsh-lm-band]').count(), 0);
});

test('WebGL shimmer preserves glyph masks, phase, clock and frame-rate preference; switching back releases canvases', async t => {
  const page = await openPage(t, 'optimized');
  await page.evaluate(() => window.mount());
  await page.waitForFunction(() => document.querySelector('#turn-status').hasAttribute('data-dsh-lm-shimmer'));
  const initial = await page.locator('#turn-status [data-dsh-lm-band]').evaluate(e => {
    const a=e.getAnimations()[0];a.pause();a.currentTime=750;return e.parentElement.style.maskImage;
  });
  await page.evaluate(() => { window.settings.setFrameRate(30); window.settings.setRenderer('webgl'); });
  await page.waitForFunction(() => document.querySelector('#turn-status [data-dsh-lm-glyphs]')?.dataset.dshLmRenderer === 'webgl2');
  assert.equal(await page.locator('canvas[data-dsh-lm-webgl]').count(), 2);
  assert.equal(await page.locator('#turn-status [data-dsh-lm-glyphs]').evaluate(e => e.style.maskImage), initial);
  assert.equal(await page.locator('#turn-status [data-dsh-lm-band]').evaluate(e => e.getAnimations()[0].currentTime), 750);
  await page.evaluate(() => window.settings.setRenderer('css'));
  assert.equal(await page.locator('canvas[data-dsh-lm-webgl]').count(), 0);
  assert.equal(await page.locator('#turn-status [data-dsh-lm-band]').evaluate(e => getComputedStyle(e).visibility), 'visible');
  assert.equal(await page.evaluate(() => window.settings.hooks.frameRate.getSnapshot().frameRate), 30);
  await page.evaluate(() => { window.settings.setRenderer('webgl'); window.unmount(); window.mount(); });
  await page.waitForFunction(() => document.querySelectorAll('[data-dsh-lm-renderer="webgl2"]').length === 2);
  assert.equal(await page.evaluate(() => window.settings.hooks.shimmerRenderer.getSnapshot().renderer), 'webgl');
  await page.evaluate(() => window.unmount());
  assert.equal(await page.locator('canvas[data-dsh-lm-webgl]').count(), 0);
});

test('WebGL unavailable, context loss and unknown color space fall back without hiding the live text', async t => {
  const page = await openPage(t, 'optimized');
  await page.evaluate(() => {
    window.originalGetContext=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(kind,...args){return kind==='webgl2'?null:window.originalGetContext.call(this,kind,...args)};
    window.mount(); window.settings.setRenderer('webgl');
  });
  await page.waitForFunction(() => document.querySelector('#turn-status [data-dsh-lm-glyphs]')?.dataset.dshLmRenderer === 'css-fallback');
  assert.equal(await page.locator('canvas[data-dsh-lm-webgl]').count(), 0);
  await page.evaluate(() => {
    HTMLCanvasElement.prototype.getContext=window.originalGetContext;
    window.settings.setRenderer('css');window.settings.setRenderer('webgl');
  });
  await page.waitForFunction(() => document.querySelectorAll('[data-dsh-lm-renderer="webgl2"]').length === 2);
  await page.locator('#turn-status canvas').evaluate(e => e.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
  await page.waitForFunction(() => document.querySelector('#turn-status [data-dsh-lm-glyphs]')?.dataset.dshLmRenderer === 'css-fallback');
  assert.equal(await page.locator('#turn-status [data-dsh-lm-band]').evaluate(e => getComputedStyle(e).visibility), 'visible');
  assert.equal(await page.locator('#turn-status').evaluate(e => e.hasAttribute('data-dsh-lm-shimmer')), true);
  await page.evaluate(() => document.querySelector('.retry-e5').style.backgroundImage='linear-gradient(90deg in oklab, red, blue)');
  await page.waitForFunction(() => document.querySelector('.retry-e5 [data-dsh-lm-glyphs]')?.dataset.dshLmRenderer === 'css-fallback');
  assert.equal(await page.locator('canvas[data-dsh-lm-webgl]').count(), 0);
});

test('WebGL pauses offscreen, on hidden pages and reduced motion and releases its shared frame loop', async t => {
  const page = await openPage(t, 'optimized');
  await page.evaluate(() => {
    window.gpuDraws=0; const original=WebGL2RenderingContext.prototype.drawArrays;
    WebGL2RenderingContext.prototype.drawArrays=function(...args){window.gpuDraws++;return original.apply(this,args)};
    window.mount();window.settings.setRenderer('webgl');
  });
  await page.waitForFunction(() => window.gpuDraws > 3);
  await page.evaluate(() => {Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'))});
  await frames(page, 3); const hidden=await page.evaluate(() => window.gpuDraws);
  await frames(page, 8); assert.equal(await page.evaluate(() => window.gpuDraws), hidden);
  await page.evaluate(() => {Object.defineProperty(document,'hidden',{value:false,configurable:true});document.dispatchEvent(new Event('visibilitychange'))});
  await page.waitForFunction(before => window.gpuDraws > before, hidden);
  await page.evaluate(() => document.querySelector('[data-chat-flow]').style.transform='translateY(10000px)');
  await frames(page, 6); const offscreen=await page.evaluate(() => window.gpuDraws);
  await frames(page, 8); assert.equal(await page.evaluate(() => window.gpuDraws), offscreen);
  await page.evaluate(() => document.querySelector('[data-chat-flow]').style.transform='');
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.waitForFunction(() => !document.querySelector('canvas[data-dsh-lm-webgl]'));
  const stopped=await page.evaluate(() => window.gpuDraws);
  await frames(page, 8); assert.equal(await page.evaluate(() => window.gpuDraws), stopped);
});

test('WebGL draws only when a capped sample changes and context budget falls back safely', async t => {
  const page=await openPage(t,'optimized');
  await page.evaluate(()=>{
    window.targetDraws=0;const original=WebGL2RenderingContext.prototype.drawArrays;
    WebGL2RenderingContext.prototype.drawArrays=function(...args){if(this.canvas.closest('#turn-status'))window.targetDraws++;return original.apply(this,args)};
    window.mount();window.settings.setFrameRate(30);window.settings.setRenderer('webgl');
  });
  await page.waitForFunction(()=>document.querySelector('#turn-status [data-dsh-lm-glyphs]')?.dataset.dshLmRenderer==='webgl2');
  await page.locator('#turn-status [data-dsh-lm-band]').evaluate(e=>{const a=e.getAnimations()[0];a.pause();a.currentTime=505});
  await frames(page,3);const before=await page.evaluate(()=>window.targetDraws);
  await page.locator('#turn-status [data-dsh-lm-band]').evaluate(e=>{e.getAnimations()[0].currentTime=515});
  await frames(page,3);assert.equal(await page.evaluate(()=>window.targetDraws),before);
  await page.locator('#turn-status [data-dsh-lm-band]').evaluate(e=>{e.getAnimations()[0].currentTime=550});
  await frames(page,3);assert.equal(await page.evaluate(()=>window.targetDraws),before+1);
  await page.evaluate(()=>{
    const flow=document.querySelector('[data-chat-flow]');
    for(let i=0;i<5;i++){const source=document.createElement('div');source.className='status-d4';source.setAttribute('role','status');source.setAttribute('aria-live','polite');source.textContent='Additional status '+i;flow.append(source)}
  });
  await page.waitForFunction(()=>document.querySelectorAll('[data-dsh-lm-renderer="css-fallback"]').length>=3);
  assert.equal(await page.locator('canvas[data-dsh-lm-webgl]').count(),4);
  await page.evaluate(()=>window.unmount());
  assert.equal(await page.locator('canvas').count(),0);
});
