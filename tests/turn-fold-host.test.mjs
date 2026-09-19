import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const DSH = process.env.DSH_CHECKOUT;
if (!DSH) throw new Error('Set DSH_CHECKOUT to an existing, built DeepSeek Harness checkout.');
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PAGE = '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>';

const ALIAS = {
  '@host/cordis': DSH + '/vendor/cordis/lib/index.js',
  '@host/ui-renderer/registry': DSH + '/packages/client/ui-renderer/src/client/registry.ts',
  '@host/ui-renderer/scoped-slots': DSH + '/packages/client/ui-renderer/src/client/scoped-slots.tsx',
  '@host/ui-chat/ChatNodeSeat': DSH + '/packages/client/ui-chat/src/client/chat/ChatNodeSeat.tsx',
  '@host/ui-chat/AssistantNodeView': DSH + '/packages/client/ui-chat/src/client/chat/AssistantNodeView.tsx',
  '@host/ui-chat/TurnProcessNodeView': DSH + '/packages/client/ui-chat/src/client/chat/TurnProcessNodeView.tsx',
  '@host/ui-chat/stores': DSH + '/packages/client/ui-chat/src/client/stores.ts',
  '@host/ui-chat/use-turn-data': DSH + '/packages/client/ui-chat/src/client/chat/use-turn-data.ts',
  '@host/ui-tool/ToolCallTree': DSH + '/packages/client/ui-tool/src/client/tool/ToolCallTree.tsx',
  '@host/ui-tool/bash': DSH + '/packages/client/ui-tool/src/client/tool/toolviews/bash-sample.tsx',
  '@host/ui-chat/ChatView.module.css': DSH + '/packages/client/ui-chat/src/client/chat/ChatView.module.css',
};

let bundleJs = '';
let bundleCss = '';
let turnFoldCss = '';
let browser;

before(async () => {
  turnFoldCss = await readFile(new URL('../src/turn-fold.css', import.meta.url), 'utf8');
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
    loader: {
      '.css': 'local-css',
      '.woff': 'empty',
      '.woff2': 'empty',
      '.ttf': 'empty',
      '.eot': 'empty',
      '.svg': 'dataurl',
    },
    alias: ALIAS,
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
  for (const file of result.outputFiles) {
    if (file.path.endsWith('.css')) bundleCss = file.text;
    else bundleJs = file.text;
  }
  browser = await chromium.launch();
});

after(async () => { await browser?.close(); });

async function open(t, options = {}) {
  const page = await browser.newPage();
  if (options.width !== undefined) {
    await page.setViewportSize({ width: options.width, height: options.height === undefined ? 800 : options.height });
  }
  t.after(() => page.close());
  page.on('pageerror', error => { console.error('pageerror:', error.stack); });
  await page.route('http://host.test/', route => route.fulfill({ contentType: 'text/html', body: PAGE }));
  await page.goto('http://host.test/');
  if (bundleCss !== '') await page.addStyleTag({ content: bundleCss });
  // The plugin's own stylesheet uses literal class names: inject the source
  // verbatim, exactly as the production client appends it to <head>.
  await page.addStyleTag({ content: turnFoldCss });
  await page.addScriptTag({ content: bundleJs });
  await page.waitForFunction(() => window.__host !== undefined);
  await page.evaluate(() => window.__host.boot());
  await page.waitForSelector('[data-host-chat]', { state: 'attached' });
  return page;
}

/** Publish a plain model (nodes/process arrays) into the harness Maps. */
async function publish(page, spec) {
  await page.evaluate(input => {
    const nodes = new Map(input.nodes.map(node => [node.key, node]));
    const process = new Map((input.process ?? []).map(item => [item.key, item.presentation]));
    const order = input.order ?? input.nodes.map(node => node.key);
    window.__host.setModel({
      order,
      nodes,
      process,
      compactTranscript: input.compactTranscript !== false,
      historyIncomplete: input.historyIncomplete === true,
    });
  }, spec);
  await page.waitForTimeout(120);
}

function specData(overrides = {}) {
  return {
    turn: 1, controlAnchorSeq: 10, processStartSeq: 5, answerAnchorSeq: 20, answerStep: 1,
    inlineReasoning: false, messageCount: 0, toolCallCount: 1, subagentCount: 0, ...overrides,
  };
}

function turnLocation(turn, status, data) {
  return { turn, status, steps: [], data: window.__host.turnDataStore(new Map()) };
}

/** A closed compact turn whose native seat owns the disclosure. */
function nativeFoldModel() {
  const spec = specData();
  const presentation = { turn: 1, spec, turnClosed: true, hasExternalProcess: true, compactAnswer: true };
  const location = { kind: 'step', turn: { turn: 1, status: 'closed', steps: [], data: null }, step: { step: 0 } };
  const nodes = [
    { key: 'u1', kind: 'user', anchorSeq: 1, visibility: 'visible', data: {}, location },
    { key: 'a0', kind: 'assistant-step', anchorSeq: 10, visibility: 'visible', data: { step: 0, status: 'settled', blocks: [{ kind: 'reasoning', text: 'think' }] }, location },
    { key: 't0', kind: 'tool-call', anchorSeq: 12, visibility: 'visible', data: { root: { callId: 'c1', name: 'bash', argsRaw: '{"command":"echo hi"}', subCalls: [] } }, location },
    { key: 'tp', kind: 'turn-process', anchorSeq: 11, visibility: 'visible', data: spec, location },
    { key: 'a1', kind: 'assistant-step', anchorSeq: 20, visibility: 'visible', data: { step: 1, status: 'settled', blocks: [{ kind: 'reasoning', text: 'final think' }, { kind: 'text', text: 'final answer' }] }, location },
  ];
  return {
    nodes,
    process: nodes.map(node => ({ key: node.key, presentation })),
    order: ['u1', 'a0', 'tp', 't0', 'a1'],
    compactTranscript: true,
    historyIncomplete: false,
  };
}

test('the real host renders a shipped BashRow through the native tool-call renderer', async (t) => {
  const page = await open(t);
  await publish(page, {
    nodes: [{
      key: 't0', kind: 'tool-call', anchorSeq: 12, visibility: 'visible',
      data: { root: { callId: 'c1', name: 'bash', argsRaw: '{"command":"echo hi"}', subCalls: [] } },
      location: { kind: 'step', turn: { turn: 1, status: 'open', steps: [], data: null }, step: { step: 0 } },
    }],
  });
  const dump = await page.evaluate(() => ({
    errors: [...document.querySelectorAll('[data-slot-error]')].map(el => el.getAttribute('data-slot-error')),
    rows: document.querySelectorAll('[data-chat-flow-kind="tool-call"]').length,
    bash: document.querySelectorAll('.bash_sample_root').length,
    text: document.body.innerText,
    nativeRoot: document.querySelector('[data-chat-call-id="c1"]') !== null,
  }));
  assert.deepEqual(dump.errors, []);
  assert.equal(dump.rows, 1);
  assert.equal(dump.nativeRoot, true);
  assert.equal(dump.bash, 1, 'the native ToolCallTree child dispatch reached the shipped BashRow');
  assert.match(dump.text, /Bash/);
});

test('the shipped ChatNodeSeat owns compact hiding: one native button, process rows seat-hidden', async (t) => {
  const page = await open(t);
  await publish(page, nativeFoldModel());
  const state = await page.evaluate(() => ({
    nativeButtons: document.querySelectorAll('[data-turn-process]').length,
    pluginControls: document.querySelectorAll('[data-dsh-turn-fold-control]').length,
    toolSeatHidden: document.querySelector('[data-chat-flow-kind="tool-call"]')?.getAttribute('hidden'),
    toolSeatConnected: document.querySelector('[data-chat-call-id="c1"]')?.isConnected === true,
    errors: [...document.querySelectorAll('[data-slot-error]')].map(el => el.getAttribute('data-slot-error')),
  }));
  assert.deepEqual(state.errors, []);
  assert.equal(state.nativeButtons, 1, 'the shipped controller is the only control row');
  assert.equal(state.pluginControls, 0, 'no plugin control row while the shipped controller owns the Turn');
  assert.equal(state.toolSeatHidden, 'until-found', 'the seat hidden rule is the shipped one');
  assert.equal(state.toolSeatConnected, true, 'hiding never unmounts the tool-call row');
});

test('registerTurnFold never shadows the tool-call key in the real slot registry', async (t) => {
  const page = await open(t);
  await publish(page, nativeFoldModel());
  const state = await page.evaluate(async () => {
    const before = window.__host.entries();
    window.__host.mountFold();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const after = window.__host.entries();
    return {
      before,
      after,
      toolCallAfter: after.filter(entry => entry.key === 'tool-call'),
      assistantAfter: after.filter(entry => entry.key === 'assistant-step'),
      bash: document.querySelectorAll('.bash_sample_root').length,
      errors: [...document.querySelectorAll('[data-slot-error]')].map(el => el.getAttribute('data-slot-error')),
    };
  });
  assert.deepEqual(state.before.filter(entry => entry.key === 'tool-call').map(entry => entry.priority), [0]);
  assert.deepEqual(state.toolCallAfter.map(entry => entry.priority), [0], 'the native tool-call entry stays the sole occupant');
  assert.ok(state.assistantAfter.some(entry => entry.priority !== 0), 'childless keys are still proxied');
  assert.equal(state.bash, 1, 'the native child dispatch still reaches BashRow after mounting');
  assert.deepEqual(state.errors, []);
});

test('foreign shadow priority makes the plugin yield without hiding content', async (t) => {
  const page = await open(t);
  await publish(page, nativeFoldModel());
  const state = await page.evaluate(async () => {
    const slots = window.__host.slots;
    const dispose = slots.register(
      { name: 'conversation.chat.node', key: 'assistant-step', priority: -1 },
      () => null,
    );
    const handle = window.__host.mountFold();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const entries = window.__host.entries().filter(entry => entry.key === 'assistant-step');
    const toolSeatHidden = document.querySelector('[data-chat-flow-kind="tool-call"]')?.getAttribute('hidden');
    const toolConnected = document.querySelector('[data-chat-call-id="c1"]')?.isConnected === true;
    dispose();
    return { foreignCount: entries.filter(entry => entry.priority === -1).length, entries, toolSeatHidden, toolConnected, handle: handle !== undefined };
  });
  assert.equal(state.foreignCount, 1);
  assert.equal(state.toolConnected, true);
  assert.equal(state.toolSeatHidden, 'until-found', 'native seat hiding still applies; nothing is left hidden by the plugin');
});

test('real control node smothers the settled tool root through the DOM bridge and expands on toggle', async (t) => {
  const page = await open(t);
  const state = await page.evaluate(async () => {
    const spec = { turn: 1, controlAnchorSeq: 10, processStartSeq: 5, answerAnchorSeq: 20, answerStep: 1, inlineReasoning: false, messageCount: 1, toolCallCount: 2, subagentCount: 0 };
    const presentation = { turn: 1, spec, turnClosed: true, hasExternalProcess: true, compactAnswer: true };
    const control = window.__host.buildControlNode({ turn: 1, spec });
    const location = { kind: 'step', turn: { turn: 1, status: 'closed', steps: [], data: null }, step: { step: 0 } };
    const nodes = [
      { key: 'a0', kind: 'assistant-step', anchorSeq: 10, visibility: 'visible', data: { step: 0, status: 'settled', blocks: [{ kind: 'reasoning', text: 'early reasoning' }] }, location },
      { key: 't0', kind: 'tool-call', anchorSeq: 11, visibility: 'visible', data: { root: { callId: 'c1', name: 'bash', argsRaw: '{"command":"running"}', subCalls: [] } }, location },
      { key: 't1', kind: 'tool-call', anchorSeq: 12, visibility: 'visible', data: { root: { kind: 'tool-result', callId: 'c2', call: { name: 'bash' }, content: [{ type: 'text', text: 'done' }], isError: false, subCalls: [] } }, location },
      { key: 'a1', kind: 'assistant-step', anchorSeq: 20, visibility: 'visible', data: { step: 1, status: 'settled', blocks: [{ kind: 'text', text: 'final answer' }] }, location },
      control,
    ];
    window.__host.setModel({
      order: nodes.map(node => node.key),
      nodes: new Map(nodes.map(node => [node.key, node])),
      process: new Map(nodes.map(node => [node.key, presentation])),
      compactTranscript: true,
      historyIncomplete: true,
    });
    window.__host.mountFold();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const settled = document.querySelector('[data-chat-call-id="c2"]');
    const running = document.querySelector('[data-chat-call-id="c1"]');
    const collapsed = {
      control: document.querySelectorAll('[data-dsh-turn-fold-control]').length,
      settledHidden: settled.getAttribute('hidden'),
      settledMarker: settled.getAttribute('data-dsh-turn-fold-tool-hidden'),
      settledConnected: settled.isConnected,
      runningHidden: running.getAttribute('hidden'),
      runningMarker: running.getAttribute('data-dsh-turn-fold-tool-hidden'),
      answer: document.body.innerText.includes('final answer'),
    };
    document.querySelector('[data-dsh-turn-fold-header]').click();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const expanded = {
      settledHidden: document.querySelector('[data-chat-call-id="c2"]').getAttribute('hidden'),
      settledMarker: document.querySelector('[data-chat-call-id="c2"]').getAttribute('data-dsh-turn-fold-tool-hidden'),
      settledConnected: document.querySelector('[data-chat-call-id="c2"]').isConnected,
      answer: document.body.innerText.includes('final answer'),
      errors: [...document.querySelectorAll('[data-slot-error]')].map(el => el.getAttribute('data-slot-error')),
    };
    document.querySelector('[data-dsh-turn-fold-header]').click();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const recollapsed = document.querySelector('[data-chat-call-id="c2"]').getAttribute('hidden');
    return { built: control !== null, collapsed, expanded, recollapsed };
  });
  assert.equal(state.built, true, 'the real Definition built the control helper');
  assert.equal(state.collapsed.control, 1);
  assert.equal(state.collapsed.settledHidden, 'until-found');
  assert.notEqual(state.collapsed.settledMarker, null);
  assert.equal(state.collapsed.settledConnected, true, 'smothering never unmounts the native root');
  assert.equal(state.collapsed.runningHidden, null, 'a running call is exempt from smothering');
  assert.equal(state.collapsed.runningMarker, null);
  assert.equal(state.collapsed.answer, true, 'the final answer body survives the fold');
  assert.equal(state.expanded.settledHidden, null);
  assert.equal(state.expanded.settledMarker, null);
  assert.equal(state.expanded.settledConnected, true);
  assert.equal(state.expanded.answer, true);
  assert.deepEqual(state.expanded.errors, []);
  assert.equal(state.recollapsed, 'until-found', 'the same control toggles back to collapsed');
});

test('a plugin mounted before the native entries re-identifies them when they arrive late', async (t) => {
  const page = await open(t);
  const state = await page.evaluate(async () => {
    window.__host.releaseNative();
    window.__host.mountFold();
    window.__host.registerNative();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const entries = window.__host.entries();
    return {
      proxies: entries.filter(entry => entry.priority !== 0 && entry.key !== window.__host.TURN_FOLD_KIND).map(entry => entry.key),
      controls: entries.filter(entry => entry.key === window.__host.TURN_FOLD_KIND).length,
      errors: [...document.querySelectorAll('[data-slot-error]')].map(el => el.getAttribute('data-slot-error')),
    };
  });
  assert.ok(state.proxies.includes('assistant-step'), 'late native entries are re-identified');
  assert.equal(state.controls, 1, 'the control entry is re-registered');
});

test('a foreign non-zero shadow on the tool-call key makes the plugin yield the whole feature', async (t) => {
  const page = await open(t);
  const state = await page.evaluate(async () => {
    window.__host.slots.register({ name: 'conversation.chat.node', key: 'tool-call', priority: -0.5 }, () => null);
    window.__host.mountFold();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const entries = window.__host.entries();
    return {
      proxies: entries.filter(entry => entry.priority !== 0).map(entry => entry.key),
      controls: entries.filter(entry => entry.key === window.__host.TURN_FOLD_KIND).length,
    };
  });
  assert.equal(state.controls, 0, 'no control entry while a foreign owner holds the tool-call cell');
  assert.deepEqual(state.proxies, ['tool-call'], 'only the foreign shadow remains');
});

test('dispose leaves no queued microtask able to re-register', async (t) => {
  const page = await open(t);
  const state = await page.evaluate(async () => {
    window.__host.mountFold();
    // Schedule a roster re-evaluation, then dispose in the same task.
    window.__host.slots.register({ name: 'conversation.chat.node', key: 'context', priority: -0.4 }, () => null);
    window.__host.unmountFold();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const entries = window.__host.entries();
    return {
      pluginProxies: entries.filter(entry => entry.priority !== 0 && entry.priority !== -0.4).map(entry => entry.key),
      controls: entries.filter(entry => entry.key === window.__host.TURN_FOLD_KIND).length,
    };
  });
  assert.deepEqual(state.pluginProxies, []);
  assert.equal(state.controls, 0);
});

test('feature exit drops the Definition, so no helper node or unknown-surface JSON noise remains', async (t) => {
  const page = await open(t);
  const state = await page.evaluate(async () => {
    const spec = { turn: 1, controlAnchorSeq: 10, processStartSeq: 5, answerAnchorSeq: 20, answerStep: 1, inlineReasoning: false, messageCount: 1, toolCallCount: 2, subagentCount: 0 };
    const presentation = { turn: 1, spec, turnClosed: true, hasExternalProcess: true, compactAnswer: true };
    const location = { kind: 'step', turn: { turn: 1, status: 'closed', steps: [], data: null }, step: { step: 0 } };
    const nodes = [
      { key: 'a0', kind: 'assistant-step', anchorSeq: 10, visibility: 'visible', data: { step: 0, status: 'settled', blocks: [{ kind: 'reasoning', text: 'r' }] }, location },
      { key: 't1', kind: 'tool-call', anchorSeq: 12, visibility: 'visible', data: { root: { kind: 'tool-result', callId: 'c2', call: { name: 'bash' }, content: [{ type: 'text', text: 'done' }], isError: false, subCalls: [] } }, location },
    ];
    const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const publish = () => window.__host.publishWithHelper({
      nodes,
      process: nodes.map(node => ({ key: node.key, presentation })),
      compactTranscript: true,
      historyIncomplete: true,
    }, { turn: 1, spec });
    const spy = window.__host.provideUiConversation();
    window.__host.mountFold();
    await settle();
    const helper = publish();
    await settle();
    const withControl = {
      helperKey: helper === null || helper === undefined ? null : helper.key,
      control: document.querySelectorAll('[data-dsh-turn-fold-control]').length,
      unknownSurface: document.body.innerText.includes('Unknown web-low-motion-turn-fold'),
      registered: spy.registered.length,
    };
    window.__host.slots.register({ name: 'conversation.chat.node', key: 'assistant-step', priority: -1 }, () => null);
    await settle();
    publish();
    await settle();
    const after = {
      control: document.querySelectorAll('[data-dsh-turn-fold-control]').length,
      unknownSurface: document.body.innerText.includes('Unknown web-low-motion-turn-fold'),
      rawSpec: document.body.innerText.includes('controlAnchorSeq'),
      errors: [...document.querySelectorAll('[data-slot-error]')].map(el => el.getAttribute('data-slot-error')),
      registered: spy.registered.length,
      removed: spy.removed.length,
      text: document.body.innerText.slice(0, 160),
    };
    return { withControl, after };
  });
  console.log('EXIT', JSON.stringify(state));
  assert.notEqual(state.withControl.helperKey, null, 'a real helper node was present before the exit');
  assert.equal(state.withControl.control, 1, 'the control renders while the plugin owns the Turn');
  assert.equal(state.withControl.unknownSurface, false);
  assert.equal(state.withControl.registered, 1);
  assert.equal(state.after.control, 0, 'the plugin yielded the control renderer');
  assert.equal(state.after.unknownSurface, false, 'the helper Definition is dropped with the renderer');
  assert.equal(state.after.rawSpec, false, 'no raw spec JSON noise');
  assert.deepEqual(state.after.errors, []);
  assert.equal(state.after.registered, 0, 'the Definition is unregistered on feature exit');
});

test('handoff keeps the reader choice across fallback and native controllers', async (t) => {
  const page = await open(t);
  const state = await page.evaluate(async () => {
    const spec = { turn: 1, controlAnchorSeq: 10, processStartSeq: 5, answerAnchorSeq: 20, answerStep: 1, inlineReasoning: false, messageCount: 1, toolCallCount: 1, subagentCount: 0 };
    const presentation = { turn: 1, spec, turnClosed: true, hasExternalProcess: true, compactAnswer: true };
    const control = window.__host.buildControlNode({ turn: 1, spec });
    const location = { kind: 'step', turn: { turn: 1, status: 'closed', steps: [], data: null }, step: { step: 0 } };
    const nodes = [
      { key: 'a0', kind: 'assistant-step', anchorSeq: 10, visibility: 'visible', data: { step: 0, status: 'settled', blocks: [{ kind: 'reasoning', text: 'r' }] }, location },
      { key: 'tp', kind: 'turn-process', anchorSeq: 11, visibility: 'visible', data: spec, location },
      { key: 't1', kind: 'tool-call', anchorSeq: 12, visibility: 'visible', data: { root: { kind: 'tool-result', callId: 'c2', call: { name: 'bash' }, content: [{ type: 'text', text: 'done' }], isError: false, subCalls: [] } }, location },
      control,
    ];
    window.__host.setModel({
      order: nodes.map(node => node.key),
      nodes: new Map(nodes.map(node => [node.key, node])),
      process: new Map(nodes.map(node => [node.key, presentation])),
      compactTranscript: true,
      historyIncomplete: true,
    });
    window.__host.mountFold();
    const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await settle();
    const read = () => ({
      controlState: document.querySelector('[data-dsh-turn-fold-control]')?.getAttribute('data-dsh-turn-fold-state'),
      nativeExpanded: document.querySelector('[data-turn-process]')?.getAttribute('aria-expanded'),
      seatHidden: document.querySelector('[data-chat-flow-kind="tool-call"]')?.getAttribute('hidden'),
      rootHidden: document.querySelector('[data-chat-call-id="c2"]')?.getAttribute('hidden'),
    });
    document.querySelector('[data-dsh-turn-fold-header]').click();
    await settle();
    const fallbackOpen = read();
    window.__host.setModel({ historyIncomplete: false });
    await settle();
    const nativeReady = read();
    document.querySelector('[data-turn-process]').click();
    await settle();
    const nativeClosed = read();
    document.querySelector('[data-turn-process]').click();
    await settle();
    window.__host.setModel({ historyIncomplete: true });
    await settle();
    const fallbackAgain = read();
    return { fallbackOpen, nativeReady, nativeClosed, fallbackAgain };
  });
  assert.equal(state.fallbackOpen.controlState, 'open');
  assert.equal(state.fallbackOpen.rootHidden, null);
  assert.equal(state.nativeReady.nativeExpanded, 'true', 'the fallback choice is pushed into the native store');
  assert.equal(state.nativeReady.seatHidden, null);
  assert.equal(state.nativeClosed.nativeExpanded, 'false');
  assert.equal(state.nativeClosed.seatHidden, 'until-found');
  assert.equal(state.fallbackAgain.controlState, 'open', 'the last native choice survives the handoff back');
  assert.equal(state.fallbackAgain.rootHidden, null);
});

test('registerTurnFold ties the Definition lifetime to the renderer without duplicates', async (t) => {
  const page = await open(t);
  const state = await page.evaluate(async () => {
    const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const spy = window.__host.provideUiConversation();
    window.__host.mountFold();
    await settle();
    const first = { registered: spy.registered.length, removed: spy.removed.length };
    window.__host.unmountFold();
    await settle();
    const disposed = { registered: spy.registered.length, removed: spy.removed.length };
    window.__host.mountFold();
    await settle();
    const second = { registered: spy.registered.length, removed: spy.removed.length };
    return { first, disposed, second };
  });
  console.log('DEFINITION', JSON.stringify(state));
  assert.equal(state.first.registered, 1, 'mount registers the Definition');
  assert.equal(state.disposed.registered, 0, 'dispose unregisters the Definition');
  assert.equal(state.second.registered, 1, 're-enable registers exactly one Definition');
});

test('without a control row the answer proxy never hides inline reasoning', async (t) => {
  const page = await open(t);
  const state = await page.evaluate(async () => {
    const spec = { turn: 1, controlAnchorSeq: 10, processStartSeq: 5, answerAnchorSeq: 20, answerStep: 1, inlineReasoning: true, messageCount: 1, toolCallCount: 0, subagentCount: 0 };
    const presentation = { turn: 1, spec, turnClosed: true, hasExternalProcess: false, compactAnswer: true };
    const location = { kind: 'step', turn: { turn: 1, status: 'closed', steps: [], data: null }, step: { step: 0 } };
    const answer = {
      key: 'a1', kind: 'assistant-step', anchorSeq: 20, visibility: 'visible',
      data: { step: 1, status: 'settled', blocks: [{ kind: 'reasoning', text: 'inline reasoning body' }, { kind: 'text', text: 'answer body' }] },
      location,
    };
    window.__host.setModel({
      order: ['a1'],
      nodes: new Map([['a1', answer]]),
      process: new Map([['a1', presentation]]),
      compactTranscript: true,
      historyIncomplete: true,
    });
    window.__host.mountFold();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {
      foldedInline: document.querySelectorAll('[data-turn-process-inline]').length,
      reasoning: document.body.innerText.includes('inline reasoning body'),
      answer: document.body.innerText.includes('answer body'),
      controls: document.querySelectorAll('[data-dsh-turn-fold-control]').length,
      errors: [...document.querySelectorAll('[data-slot-error]')].map(el => el.getAttribute('data-slot-error')),
    };
  });
  assert.equal(state.controls, 0, 'no control row exists for this Turn');
  assert.equal(state.foldedInline, 0, 'missing control/ready must not fold inline reasoning');
  assert.equal(state.reasoning, true);
  assert.equal(state.answer, true);
  assert.deepEqual(state.errors, []);
});

test('a first native open after an explicit fallback close is not rolled back', async (t) => {
  const page = await open(t);
  const state = await page.evaluate(async () => {
    const spec = { turn: 1, controlAnchorSeq: 10, processStartSeq: 5, answerAnchorSeq: 20, answerStep: 1, inlineReasoning: false, messageCount: 1, toolCallCount: 1, subagentCount: 0 };
    const presentation = { turn: 1, spec, turnClosed: true, hasExternalProcess: true, compactAnswer: true };
    const control = window.__host.buildControlNode({ turn: 1, spec });
    const location = { kind: 'step', turn: { turn: 1, status: 'closed', steps: [], data: null }, step: { step: 0 } };
    const nodes = [
      { key: 'a0', kind: 'assistant-step', anchorSeq: 10, visibility: 'visible', data: { step: 0, status: 'settled', blocks: [{ kind: 'reasoning', text: 'r' }] }, location },
      { key: 'tp', kind: 'turn-process', anchorSeq: 11, visibility: 'visible', data: spec, location },
      { key: 't1', kind: 'tool-call', anchorSeq: 12, visibility: 'visible', data: { root: { kind: 'tool-result', callId: 'c2', call: { name: 'bash' }, content: [{ type: 'text', text: 'done' }], isError: false, subCalls: [] } }, location },
      control,
    ];
    window.__host.setModel({
      order: nodes.map(node => node.key),
      nodes: new Map(nodes.map(node => [node.key, node])),
      process: new Map(nodes.map(node => [node.key, presentation])),
      compactTranscript: true,
      historyIncomplete: true,
    });
    window.__host.mountFold();
    const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await settle();
    // Explicit fallback close: open then close through the control header.
    document.querySelector('[data-dsh-turn-fold-header]').click();
    await settle();
    document.querySelector('[data-dsh-turn-fold-header]').click();
    await settle();
    const fallbackClosed = {
      controlState: document.querySelector('[data-dsh-turn-fold-control]')?.getAttribute('data-dsh-turn-fold-state'),
      explicitClosed: document.querySelector('[data-dsh-turn-fold-control]')?.getAttribute('data-dsh-turn-fold-state') === 'collapsed',
    };
    window.__host.setModel({ historyIncomplete: false });
    await settle();
    const nativeReady = { expanded: document.querySelector('[data-turn-process]')?.getAttribute('aria-expanded') };
    document.querySelector('[data-turn-process]').click();
    await settle();
    const afterFirstClick = {
      expanded: document.querySelector('[data-turn-process]')?.getAttribute('aria-expanded'),
      seatHidden: document.querySelector('[data-chat-flow-kind="tool-call"]')?.getAttribute('hidden'),
    };
    return { fallbackClosed, nativeReady, afterFirstClick };
  });
  assert.equal(state.fallbackClosed.controlState, 'collapsed');
  assert.equal(state.nativeReady.expanded, 'false', 'the explicit fallback close is pushed into the native store');
  assert.equal(state.afterFirstClick.expanded, 'true', 'the first native open must not be rolled back');
  assert.equal(state.afterFirstClick.seatHidden, null);
});

test('the real stylesheet loads and a long 360px header does not overflow its column', async (t) => {
  const page = await open(t, { width: 360, height: 800 });
  const state = await page.evaluate(async () => {
    const spec = { turn: 1, controlAnchorSeq: 10, processStartSeq: 5, answerAnchorSeq: null, answerStep: null, inlineReasoning: false, messageCount: 3, toolCallCount: 2, subagentCount: 1 };
    const presentation = { turn: 1, spec, turnClosed: true, hasExternalProcess: true, compactAnswer: true };
    const control = window.__host.buildControlNode({ turn: 1, spec, endKind: 'error' });
    const location = { kind: 'step', turn: { turn: 1, status: 'closed', steps: [], data: null }, step: { step: 0 } };
    const nodes = [
      { key: 'a0', kind: 'assistant-step', anchorSeq: 10, visibility: 'visible', data: { step: 0, status: 'settled', blocks: [{ kind: 'reasoning', text: 'r' }] }, location },
      { key: 't0', kind: 'tool-call', anchorSeq: 11, visibility: 'visible', data: { root: { callId: 'c1', name: 'bash', argsRaw: '{"command":"echo x"}', subCalls: [] } }, location },
      { key: 't1', kind: 'tool-call', anchorSeq: 12, visibility: 'visible', data: { root: { kind: 'tool-result', callId: 'c2', call: { name: 'bash' }, content: [{ type: 'text', text: 'done' }], isError: false, subCalls: [] } }, location },
      control,
    ];
    window.__host.setModel({
      order: [...nodes].sort((left, right) => left.anchorSeq - right.anchorSeq).map(node => node.key),
      nodes: new Map(nodes.map(node => [node.key, node])),
      process: new Map(nodes.map(node => [node.key, presentation])),
      compactTranscript: true,
      historyIncomplete: true,
    });
    window.__host.mountFold();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const header = document.querySelector('[data-dsh-turn-fold-header]');
    const style = getComputedStyle(header);
    return {
      display: style.display,
      whiteSpace: style.whiteSpace,
      borderTopWidth: style.borderTopWidth,
      viewport: window.innerWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      documentClientWidth: document.documentElement.clientWidth,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      headerClientWidth: header.clientWidth,
      headerScrollWidth: header.scrollWidth,
      headerOwnOverflow: header.scrollWidth > header.clientWidth,
      text: header.innerText,
    };
  });
  assert.equal(state.display, 'flex', 'the real plugin stylesheet must be loaded, not the UA default button');
  assert.equal(state.whiteSpace, 'nowrap');
  assert.equal(state.borderTopWidth, '0px', 'no UA default button border');
  assert.equal(state.viewport, 360);
  assert.equal(state.horizontalOverflow, false, 'a long header must not overflow a 360px column');
  assert.equal(state.headerOwnOverflow, false, 'the header must fit its column');
});

test('a folded process seat loses its top margin while the next visible row keeps the normal gap', async (t) => {
  const page = await open(t);
  const state = await page.evaluate(async () => {
    const spec = { turn: 1, controlAnchorSeq: 10, processStartSeq: 5, answerAnchorSeq: 20, answerStep: 1, inlineReasoning: false, messageCount: 1, toolCallCount: 1, subagentCount: 0 };
    const presentation = { turn: 1, spec, turnClosed: true, hasExternalProcess: true, compactAnswer: true };
    const control = window.__host.buildControlNode({ turn: 1, spec });
    const location = { kind: 'step', turn: { turn: 1, status: 'closed', steps: [], data: null }, step: { step: 0 } };
    const nodes = [
      { key: 'a0', kind: 'assistant-step', anchorSeq: 10, visibility: 'visible', data: { step: 0, status: 'settled', blocks: [{ kind: 'reasoning', text: 'r' }] }, location },
      { key: 't1', kind: 'tool-call', anchorSeq: 12, visibility: 'visible', data: { root: { kind: 'tool-result', callId: 'c2', call: { name: 'bash' }, content: [{ type: 'text', text: 'done' }], isError: false, subCalls: [] } }, location },
      { key: 'a1', kind: 'assistant-step', anchorSeq: 20, visibility: 'visible', data: { step: 1, status: 'settled', blocks: [{ kind: 'text', text: 'final answer body' }] }, location },
      control,
    ];
    window.__host.setModel({
      order: [...nodes].sort((left, right) => left.anchorSeq - right.anchorSeq).map(node => node.key),
      nodes: new Map(nodes.map(node => [node.key, node])),
      process: new Map(nodes.map(node => [node.key, presentation])),
      compactTranscript: true,
      historyIncomplete: true,
    });
    window.__host.mountFold();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const marginOf = key => {
      const seat = document.querySelector('[data-chat-flow-key="' + key + '"]');
      return seat === null ? null : getComputedStyle(seat).marginTop;
    };
    return {
      controlState: document.querySelector('[data-dsh-turn-fold-control]')?.getAttribute('data-dsh-turn-fold-state'),
      proxyCollapsed: document.querySelector('[data-dsh-turn-fold-node][data-dsh-turn-fold-state="collapsed"]') !== null,
      marker: document.querySelector('[data-chat-call-id="c2"]')?.getAttribute('data-dsh-turn-fold-tool-hidden'),
      a0Margin: marginOf('a0'),
      t1Margin: marginOf('t1'),
      a1Margin: marginOf('a1'),
      answerText: document.body.innerText.includes('final answer body'),
    };
  });
  assert.equal(state.controlState, 'collapsed');
  assert.equal(state.proxyCollapsed, true);
  assert.notEqual(state.marker, null);
  assert.equal(state.a0Margin, '0px', 'a collapsed proxy seat loses its own top margin');
  assert.equal(state.t1Margin, '0px', 'a smothered tool seat loses its own top margin');
  assert.equal(state.a1Margin, '16px', 'the next visible row keeps the normal column gap');
  assert.equal(state.answerText, true);
});

for (const omitControl of [false, true]) {
  test('simultaneous same-session views retain local fold readiness; second control omitted=' + omitControl, async t => {
    const page = await open(t);
    const result = await page.evaluate(async omit => {
      const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const spec = { turn: 1, controlAnchorSeq: 10, processStartSeq: 5, answerAnchorSeq: 20, answerStep: 1, inlineReasoning: false, messageCount: 1, toolCallCount: 0, subagentCount: 0 };
      const presentation = { turn: 1, spec, turnClosed: true, hasExternalProcess: true, compactAnswer: true };
      const location = { kind: 'step', turn: { turn: 1, status: 'closed', steps: [], data: null }, step: { step: 0 } };
      const nodes = [
        { key: 'early', kind: 'assistant-step', anchorSeq: 10, visibility: 'visible', data: { step: 0, status: 'settled', blocks: [{ kind: 'text', text: 'earlier reply' }] }, location },
        { key: 'answer', kind: 'assistant-step', anchorSeq: 20, visibility: 'visible', data: { step: 1, status: 'settled', blocks: [{ kind: 'text', text: 'final answer' }] }, location },
        window.__host.buildControlNode({ turn: 1, spec }),
      ];
      window.__host.setModel({ order: nodes.map(n => n.key), nodes: new Map(nodes.map(n => [n.key, n])), process: new Map(nodes.map(n => [n.key, presentation])), historyIncomplete: true });
      window.__host.mountFold();
      await settle();
      const read = id => ({
        collapsed: document.querySelectorAll(id + ' [data-dsh-turn-fold-node][data-dsh-turn-fold-state="collapsed"]').length,
        controls: document.querySelectorAll(id + ' [data-dsh-turn-fold-control]').length,
      });
      const initial = read('#root');
      window.__host.mountSecondary(omit);
      await settle();
      const second = read('#secondary');
      window.__host.unmountSecondary();
      await settle();
      const remaining = read('#root');
      window.__host.unmountFold();
      await settle();
      const disposed = read('#root');
      window.__host.mountFold();
      await settle();
      return { initial, second, remaining, disposed, restored: read('#root'), errors: document.querySelectorAll('[data-slot-error]').length };
    }, omitControl);
    assert.deepEqual(result.initial, { collapsed: 1, controls: 1 });
    assert.deepEqual(result.second, omitControl ? { collapsed: 0, controls: 0 } : { collapsed: 1, controls: 1 });
    assert.deepEqual(result.remaining, result.initial);
    assert.deepEqual(result.disposed, { collapsed: 0, controls: 0 });
    assert.deepEqual(result.restored, result.initial);
    assert.equal(result.errors, 0);
  });
}
