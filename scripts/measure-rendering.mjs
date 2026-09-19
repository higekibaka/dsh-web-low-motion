import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { build } from 'esbuild';

// An owned, synthetic page only; never attaches to an existing browser.
const root = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({ absWorkingDir: root, entryPoints: ['src/optimized.js'], bundle: true,
  write: false, format: 'iife', globalName: 'DshOptimized', loader: { '.css': 'text' } });
const fixture = await readFile(new URL('../tests/activity.html', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.DSH_PERF_CHROME || undefined });
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1704, height: 870 }, deviceScaleFactor: 1.5, reducedMotion: 'no-preference' });
  await page.setContent(fixture);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const text = '[data-chat-flow] > [role="status"][aria-live="polite"], [data-chat-flow] details[data-active] > summary > [role="status"]';
  await page.addStyleTag({content: '.row-a1::after,.shell-b2::after,.toast-f6{animation:none!important}'});
  for (const [name, css] of [
    ['legacy-text-shimmer', '/* native renderer */'],
    ['optimized', '/* baseline */'],
    ['without-text-animation', `${text}{animation:none!important}`],
    ['without-dot-animation', 'svg[data-state="ongoing"] rect{animation:none!important}'],
    ['legacy-text-shimmer-repeat', '/* native renderer */'],
  ]) {
    await page.evaluate(name => {
      window.disposeOptimized?.();
      window.disposeOptimized = name.startsWith('legacy') ? null : DshOptimized.mountOptimized();
    }, name);
    const style = await page.addStyleTag({ content: css });
    await page.waitForTimeout(400);
    const masked = await page.locator('[data-dsh-lm-shimmer]').count();
    if ((name === 'optimized' && masked !== 2) || (name.startsWith('legacy') && masked !== 0)) throw new Error('Incorrect comparison renderer: ' + name);
    const start = await cdp.send('Performance.getMetrics');
    const startTime = performance.now();
    await page.waitForTimeout(1200);
    const elapsedMs = performance.now() - startTime;
    const end = await cdp.send('Performance.getMetrics');
    const delta = name => end.metrics.find(x => x.name === name).value - start.metrics.find(x => x.name === name).value;
    results.push({ name, elapsedMs, layouts: delta('LayoutCount'), styleRecalculations: delta('RecalcStyleCount'), taskWallSeconds: delta('TaskDuration') });
    await style.evaluate(e => e.remove());
  }
  const result = { browser: browser.version(), platform: process.platform, synthetic: true, results };
  if (process.env.DSH_PERF_RESULT) await writeFile(process.env.DSH_PERF_RESULT, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
