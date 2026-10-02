import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const checkout = process.env.DSH_MODERN_CHECKOUT || process.env.DSH_CHECKOUT;
const entry = `${checkout}/packages/client/ui-chat/src/client/chat/RunningStatus.tsx`;
const available = checkout && existsSync(entry);
const smil = available && readFileSync(`${checkout}/packages/client/ui-chat/src/client/chat/RunningWhaleTail.tsx`, 'utf8').includes('<animate ');
// Release CI must execute the matching host variant, never silently skip it.
if (process.env.DSH_MODERN_VARIANT) {
  assert.ok(available, 'The required modern DSH fixture is missing');
  assert.equal(smil ? 'smil' : 'apng', process.env.DSH_MODERN_VARIANT, 'Wrong modern DSH fixture');
}
let browser, fixture, controller;
const lowCss = readFileSync(new URL('../src/low-motion.css', import.meta.url), 'utf8');

before(async () => {
  if (!available) return;
  const req = createRequire(`${process.env.DSH_CHECKOUT || checkout}/packages/client/ui-primitives/package.json`);
  const { transform } = createRequire(`${process.env.DSH_CHECKOUT || checkout}/package.json`)('lightningcss');
  const styles = [];
  const result = await build({
    entryPoints: [entry], outfile: 'fixture.cjs', bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', write: false,
    plugins: [{ name: 'host-react', setup(b) {
      b.onResolve({ filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ }, () => ({ path: `${checkout}/packages/client/ui-primitives/src/TextShimmer.tsx` }));
      b.onResolve({ filter: /^(react(?:\/.*)?|clsx)$/ }, args => ({ path: req.resolve(args.path), external: true }));
      b.onLoad({ filter: /\.css$/ }, args => {
        const { code, exports: names } = transform({ filename: args.path, code: readFileSync(args.path), cssModules: { pattern: '[hash]_[local]' }, minify: true });
        let css = code.toString();
        if (css.includes('running-whale@2x.png')) css = css.replace(/url\([^)]*running-whale@2x\.png[^)]*\)/g, `url(data:image/png;base64,${readFileSync(`${checkout}/packages/client/ui-chat/src/client/chat/running-whale@2x.png`).toString('base64')})`);
        styles.push(css);
        return { contents: `export default ${JSON.stringify(Object.fromEntries(Object.entries(names).map(([key, value]) => [key, value.name])))}`, loader: 'js' };
      });
    }}],
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', result.outputFiles.find(f => f.path.endsWith('.cjs')).text)(req, module, module.exports);
  const React = req('react');
  const html = req('react-dom/server').renderToStaticMarkup(React.createElement(module.exports.RunningStatus, { t: key => key }));
  const css = styles.join('\n');
  fixture = `<style>${css}</style><div data-chat-flow>${html}</div><button>Stop</button><video></video>`;
  const bundled = await build({ entryPoints: [fileURLToPath(new URL('../src/modern-motion.js', import.meta.url))], bundle: true, format: 'iife', globalName: 'Modern', write: false });
  controller = bundled.outputFiles[0].text;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); });

const whaleStopped = () => {
  const svg = document.querySelector('[data-chat-running] svg');
  return svg.querySelector('animate') ? svg.animationsPaused() : getComputedStyle(svg.previousElementSibling).display === 'none';
};

async function pageFor(t, mode = 'optimized', frameRate = 0) {
  const page = await browser.newPage({ reducedMotion: 'no-preference' });
  page.setDefaultTimeout(10000);
  t.after(() => page.close());
  await page.setContent(fixture);
  await page.addScriptTag({ content: controller });
  if (mode === 'reduced') { const style = await page.addStyleTag({ content: lowCss }); await style.evaluate(e => e.id = 'reduced-test-css'); }
  await page.evaluate(({ mode, frameRate }) => { window.stopMotion = Modern.mountModernMotion(document, window, mode, frameRate); }, { mode, frameRate });
  return page;
}

test('0.2 reduced mode preserves base text and static whale and restores ownership', { skip: !available }, async t => {
  const page = await pageFor(t, 'reduced');
  assert.equal(await page.locator('[data-shimmer] > [aria-hidden="true"]').evaluate(e => getComputedStyle(e).display), 'none');
  assert.notEqual(await page.locator('[data-shimmer] > :first-child').evaluate(e => getComputedStyle(e).display), 'none');
  if (smil) {
    assert.equal(await page.locator('path:has(animate)').evaluate(e => getComputedStyle(e).display), 'none');
    assert.notEqual(await page.locator('path:has(animate) + path').evaluate(e => getComputedStyle(e).display), 'none');
  } else {
    assert.notEqual(await page.locator('[data-chat-running] svg').evaluate(e => getComputedStyle(e).display), 'none');
  }
  assert.equal(await page.evaluate(whaleStopped), true);
  await page.locator('button').click();
  assert.equal(await page.locator('video').count(), 1);
  await page.evaluate(() => { window.stopMotion(); document.getElementById('reduced-test-css')?.remove(); });
  assert.equal(await page.evaluate(whaleStopped), false);
});

test('0.2 optimized mode caps native transforms without changing duration or selectable text', { skip: !available }, async t => {
  const page = await pageFor(t, 'optimized', 24);
  await page.waitForFunction(() => [...document.querySelector('[data-shimmer]').getAnimations({ subtree: true })].filter(a => a.effect.target.style.animationTimingFunction.startsWith('linear(')).length === 2);
  const values = await page.locator('[data-shimmer]').evaluate(e => e.getAnimations({ subtree: true }).map(a => ({ duration: a.effect.getTiming().duration, timing: a.effect.target.style.animationTimingFunction })));
  assert.ok(values.every(v => v.duration === 1500 && v.timing.startsWith('linear(')));
  assert.equal(await page.evaluate(whaleStopped), false);
  await page.evaluate(() => window.stopMotion.setFrameRate(0));
  assert.equal(await page.locator('[data-shimmer]').evaluate(e => e.getAnimations({ subtree: true }).every(a => a.effect.target.style.animationTimingFunction === '')), true);
  assert.match(await page.locator('[data-shimmer] > :first-child').textContent(), /chat.deepDiving/);
});

test('0.2 optimized mode pauses offscreen effects and resumes them on return', { skip: !available }, async t => {
  const page = await pageFor(t);
  await page.locator('[data-chat-running]').evaluate(e => { e.style.marginTop = '3000px'; });
  await page.waitForFunction(whaleStopped);
  assert.equal(await page.locator('[data-shimmer]').evaluate(e => e.getAnimations({ subtree: true }).every(a => a.playState === 'paused')), true);
  await page.locator('[data-chat-running]').evaluate(e => { e.style.marginTop = '0'; });
  await page.waitForFunction(`!(${whaleStopped.toString()})()`);
  await page.evaluate(() => { window.stopMotion(); document.getElementById('reduced-test-css')?.remove(); });
  assert.equal(await page.locator('[data-shimmer] [style]').evaluateAll(es => es.every(e => !e.style.animationPlayState && !e.style.animationTimingFunction)), true);
});

test('0.2 responds to page visibility and system motion preferences', { skip: !available }, async t => {
  const page = await pageFor(t);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  assert.equal(await page.evaluate(whaleStopped), true);
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForFunction(`!(${whaleStopped.toString()})()`);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(whaleStopped);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForFunction(`!(${whaleStopped.toString()})()`);
});

test('0.2 handles later whales in reduced mode without observing message mutations', { skip: !available }, async t => {
  const page = await pageFor(t, 'reduced');
  await page.locator('[data-chat-running]').evaluate(e => {
    const next = e.cloneNode(true); next.id = 'later';
    // A newly rendered host icon has no inline styles owned by the first icon's controller.
    const svg = next.querySelector('svg');
    if (!svg.querySelector('animate')) { svg.style.removeProperty('display'); svg.previousElementSibling.style.removeProperty('display'); }
    e.after(next);
  });
  await page.waitForFunction(() => { const svg = document.querySelector('#later svg'); return svg.querySelector('animate') ? svg.animationsPaused() : getComputedStyle(svg.previousElementSibling).display === 'none'; });
  assert.match(await page.locator('#later [data-shimmer] > :first-child').textContent(), /chat.deepDiving/);
  await page.evaluate(() => { window.stopMotion(); document.getElementById('reduced-test-css')?.remove(); });
  assert.equal(await page.locator('#later svg').evaluate(e => e.querySelector('animate') ? e.animationsPaused() : getComputedStyle(e.previousElementSibling).display === 'none'), false);
});

test('0.2 preserves already paused SVG and unrelated animations when unloading', { skip: !available || !smil }, async t => {
  const page = await browser.newPage(); t.after(() => page.close());
  await page.setContent(fixture);
  await page.addScriptTag({ content: controller });
  await page.locator('svg').evaluate(e => e.pauseAnimations());
  await page.evaluate(() => { const stop = Modern.mountModernMotion(document, window, 'reduced'); stop(); });
  assert.equal(await page.locator('svg').evaluate(e => e.animationsPaused()), true);
});


for (const offscreen of [false, true]) {
  test('0.2 releases removed ' + (offscreen ? 'offscreen' : 'visible') + ' status subtrees without global events', { skip: !available }, async t => {
    const page = await browser.newPage({ reducedMotion: 'no-preference' });
    t.after(() => page.close());
    await page.setContent(fixture);
    await page.addScriptTag({ content: controller });
    await page.evaluate(offscreen => {
      window.observed = new Set();
      const Original = window.IntersectionObserver;
      window.IntersectionObserver = class extends Original {
        observe(element) { window.observed.add(element); super.observe(element); }
        unobserve(element) { window.observed.delete(element); super.unobserve(element); }
        disconnect() { window.observed.clear(); super.disconnect(); }
      };
      if (offscreen) document.querySelector('[data-chat-flow]').style.marginTop = '3000px';
      window.stopMotion = Modern.mountModernMotion(document, window, 'optimized', 24);
    }, offscreen);
    await page.waitForFunction(() => window.observed.size === 2);
    if (offscreen) await page.waitForFunction(whaleStopped);
    else await page.evaluate(async () => { for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame); });
    await page.locator('[data-chat-flow]').evaluate(e => { window.removedFlow = e; e.remove(); });
    await page.waitForFunction(() => window.observed.size === 0, null, { timeout: 3000 });
    assert.equal(await page.evaluate(() => [...window.removedFlow.querySelectorAll('[style]')].every(e => !e.style.animationTimingFunction && !e.style.animationPlayState)), true);
    await page.evaluate(() => window.stopMotion());
  });
}

test('0.2 APNG restores preexisting display styles and discovers later optimized whales', { skip: !available || smil }, async t => {
  const page = await pageFor(t);
  await page.locator('[data-chat-running]').evaluate(e => { const next = e.cloneNode(true); next.id = 'later'; next.style.marginTop = '3000px'; e.after(next); });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#later svg').previousElementSibling).display === 'none');
  await page.locator('#later').evaluate(e => e.style.marginTop = '0');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#later svg').previousElementSibling).display !== 'none');
  await page.evaluate(() => {
    window.stopMotion();
    const svg = document.querySelector('[data-chat-running] svg');
    svg.style.setProperty('display', 'block', 'important');
    svg.previousElementSibling.style.setProperty('display', 'inline', 'important');
    Modern.mountModernMotion(document, window, 'reduced')();
  });
  assert.deepEqual(await page.locator('[data-chat-running] svg').first().evaluate(e => [e.style.display, e.style.getPropertyPriority('display'), e.previousElementSibling.style.display, e.previousElementSibling.style.getPropertyPriority('display')]), ['block', 'important', 'inline', 'important']);
});
