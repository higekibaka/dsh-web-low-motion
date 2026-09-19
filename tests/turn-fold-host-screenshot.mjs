/**
 * One-off host probe: captures the collapsed/expanded fallback control at a
 * 360px viewport with the REAL plugin stylesheet (literal class names) and the
 * REAL ChatView column class, and reports horizontal overflow. Synthetic,
 * non-sensitive content only. Not part of the test suite.
 */
import { fileURLToPath } from 'node:url';
import { mkdir, readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const DSH = process.env.DSH_CHECKOUT;
if (!DSH) throw new Error('Set DSH_CHECKOUT to an existing, built DeepSeek Harness checkout.');
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ARTIFACTS = fileURLToPath(new URL('../.artifacts/', import.meta.url));
const PAGE = '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>';

const result = await build({
  absWorkingDir: ROOT,
  entryPoints: ['tests/turn-fold-host.entry.jsx'],
  outfile: 'host.js',
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  loader: { '.css': 'local-css', '.woff': 'empty', '.woff2': 'empty', '.ttf': 'empty', '.eot': 'empty', '.svg': 'dataurl' },
  alias: {
    '@host/cordis': DSH + '/vendor/cordis/lib/index.js',
    '@host/ui-renderer/registry': DSH + '/packages/client/ui-renderer/src/client/registry.ts',
    '@host/ui-renderer/scoped-slots': DSH + '/packages/client/ui-renderer/src/client/scoped-slots.tsx',
    '@host/ui-chat/ChatNodeSeat': DSH + '/packages/client/ui-chat/src/client/chat/ChatNodeSeat.tsx',
    '@host/ui-chat/AssistantNodeView': DSH + '/packages/client/ui-chat/src/client/chat/AssistantNodeView.tsx',
    '@host/ui-chat/TurnProcessNodeView': DSH + '/packages/client/ui-chat/src/client/chat/TurnProcessNodeView.tsx',
    '@host/ui-chat/stores': DSH + '/packages/client/ui-chat/src/client/stores.ts',
    '@host/ui-chat/use-turn-data': DSH + '/packages/client/ui-chat/src/client/chat/use-turn-data.ts',
    '@host/ui-chat/ChatView.module.css': DSH + '/packages/client/ui-chat/src/client/chat/ChatView.module.css',
    '@host/ui-tool/ToolCallTree': DSH + '/packages/client/ui-tool/src/client/tool/ToolCallTree.tsx',
    '@host/ui-tool/bash': DSH + '/packages/client/ui-tool/src/client/tool/toolviews/bash-sample.tsx',
  },
  nodePaths: [
    DSH + '/node_modules/.pnpm/react@18.3.1/node_modules',
    DSH + '/node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules',
    DSH + '/node_modules/.pnpm/scheduler@0.23.2/node_modules',
    DSH + '/node_modules/.pnpm/use-sync-external-store@1.2.0_react@18.3.1/node_modules',
    DSH + '/node_modules/.pnpm/clsx@2.1.1/node_modules',
  ],
  define: { 'process.env.NODE_ENV': '"development"' },
  logLevel: 'warning',
});
let bundleJs = '';
let bundleCss = '';
for (const file of result.outputFiles) {
  if (file.path.endsWith('.css')) bundleCss = file.text;
  else bundleJs = file.text;
}
const turnFoldCss = await readFile(new URL('../src/turn-fold.css', import.meta.url), 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 360, height: 800 } });
await page.route('http://host.test/', route => route.fulfill({ contentType: 'text/html', body: PAGE }));
await page.goto('http://host.test/');
if (bundleCss !== '') await page.addStyleTag({ content: bundleCss });
await page.addStyleTag({ content: turnFoldCss });
await page.addScriptTag({ content: bundleJs });
await page.waitForFunction(() => window.__host !== undefined);
await page.evaluate(() => window.__host.boot());
await page.waitForSelector('[data-host-chat]', { state: 'attached' });

await page.evaluate(async () => {
  const specOne = { turn: 1, controlAnchorSeq: 10, processStartSeq: 5, answerAnchorSeq: null, answerStep: null, inlineReasoning: false, messageCount: 3, toolCallCount: 2, subagentCount: 1 };
  const specTwo = { turn: 2, controlAnchorSeq: 20, processStartSeq: 15, answerAnchorSeq: 30, answerStep: 1, inlineReasoning: true, messageCount: 1, toolCallCount: 1, subagentCount: 0 };
  const presentationOne = { turn: 1, spec: specOne, turnClosed: true, hasExternalProcess: true, compactAnswer: true };
  const presentationTwo = { turn: 2, spec: specTwo, turnClosed: true, hasExternalProcess: true, compactAnswer: true };
  const controlOne = window.__host.buildControlNode({ turn: 1, spec: specOne, endKind: 'error' });
  const controlTwo = window.__host.buildControlNode({ turn: 2, spec: specTwo });
  const loc = turn => ({ kind: 'step', turn: { turn, status: 'closed', steps: [], data: null }, step: { step: 0 } });
  const nodes = [
    { key: 'a0', kind: 'assistant-step', anchorSeq: 10, visibility: 'visible', data: { step: 0, status: 'settled', blocks: [{ kind: 'reasoning', text: 'synthetic reasoning one' }] }, location: loc(1) },
    { key: 't0', kind: 'tool-call', anchorSeq: 11, visibility: 'visible', data: { root: { callId: 'c1', name: 'bash', argsRaw: '{"command":"echo synthetic"}', subCalls: [] } }, location: loc(1) },
    { key: 't1', kind: 'tool-call', anchorSeq: 12, visibility: 'visible', data: { root: { kind: 'tool-result', callId: 'c2', call: { name: 'bash' }, content: [{ type: 'text', text: 'synthetic output' }], isError: false, subCalls: [] } }, location: loc(1) },
    controlOne,
    { key: 'a2', kind: 'assistant-step', anchorSeq: 20, visibility: 'visible', data: { step: 0, status: 'settled', blocks: [{ kind: 'reasoning', text: 'synthetic reasoning two' }] }, location: loc(2) },
    { key: 't2', kind: 'tool-call', anchorSeq: 21, visibility: 'visible', data: { root: { kind: 'tool-result', callId: 'c3', call: { name: 'bash' }, content: [{ type: 'text', text: 'synthetic output two' }], isError: false, subCalls: [] } }, location: loc(2) },
    { key: 'a3', kind: 'assistant-step', anchorSeq: 30, visibility: 'visible', data: { step: 1, status: 'settled', blocks: [{ kind: 'reasoning', text: 'final think' }, { kind: 'text', text: 'synthetic final answer' }] }, location: loc(2) },
    controlTwo,
  ];
  window.__host.setModel({
    order: [...nodes].sort((left, right) => left.anchorSeq - right.anchorSeq).map(node => node.key),
    nodes: new Map(nodes.map(node => [node.key, node])),
    process: new Map([
      ['a0', presentationOne], ['t0', presentationOne], ['t1', presentationOne], [controlOne.key, presentationOne],
      ['a2', presentationTwo], ['t2', presentationTwo], ['a3', presentationTwo], [controlTwo.key, presentationTwo],
    ]),
    compactTranscript: true,
    historyIncomplete: true,
  });
  window.__host.mountFold();
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
});

function measure() {
  const headers = [...document.querySelectorAll('[data-dsh-turn-fold-header]')].map(header => ({
    text: header.innerText,
    clientWidth: header.clientWidth,
    scrollWidth: header.scrollWidth,
    ownOverflow: header.scrollWidth > header.clientWidth,
    right: Math.round(header.getBoundingClientRect().right),
  }));
  return {
    viewport: window.innerWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    documentClientWidth: document.documentElement.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    headers,
    flowOrder: [...document.querySelectorAll('[data-chat-flow] > [data-chat-flow-key]')].map(el => el.getAttribute('data-chat-flow-key')),
  };
}

await mkdir(ARTIFACTS, { recursive: true });
const collapsed = await page.evaluate(measure);
await page.screenshot({ path: ARTIFACTS + 'turn-fold-collapsed.png', fullPage: true });
await page.evaluate(() => {
  for (const header of document.querySelectorAll('[data-dsh-turn-fold-header]')) header.click();
});
await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const expanded = await page.evaluate(measure);
await page.screenshot({ path: ARTIFACTS + 'turn-fold-expanded.png', fullPage: true });
console.log(JSON.stringify({ collapsed, expanded }, null, 2));
await browser.close();
