import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DSH = process.env.DSH_CHECKOUT;
if (!DSH) throw new Error('Set DSH_CHECKOUT to an existing, built DeepSeek Harness checkout.');
const pluginBundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
const harnessPath = fileURLToPath(new URL('../.artifacts/turn-fold-harness.js', import.meta.url));
const PAGE = '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>';
let browser;

before(async () => {
  await build({
    absWorkingDir: ROOT,
    entryPoints: ['tests/turn-fold-harness.entry.jsx'],
    outfile: '.artifacts/turn-fold-harness.js',
    bundle: true, format: 'iife', platform: 'browser', target: 'es2022', jsx: 'automatic',
    alias: { '@dsl-slots': DSH + '/packages/client/ui-slots/lib/index.js' },
    nodePaths: [
      DSH + '/node_modules/.pnpm/react@18.3.1/node_modules',
      DSH + '/node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules',
      DSH + '/node_modules/.pnpm/scheduler@0.23.2/node_modules',
    ],
    define: { 'process.env.NODE_ENV': '"development"' },
    logLevel: 'silent',
  });
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); });

const SPEC = (overrides = {}) => ({
  turn: 1, controlAnchorSeq: 10, processStartSeq: 5,
  answerAnchorSeq: null, answerStep: null, inlineReasoning: false,
  messageCount: 0, toolCallCount: 0, subagentCount: 0, ...overrides,
});
const control = (spec, turn = 1) => ({ key: 'tf', kind: 'web-low-motion-turn-fold', anchorSeq: spec.controlAnchorSeq - 0.05, turn, data: spec });

function noAnswerModel({ error = false, limit = false, sessionId = 's1' } = {}) {
  const spec = SPEC({ messageCount: 1, toolCallCount: 1 });
  const nodes = [
    { key: 'u1', kind: 'user', anchorSeq: 1, turn: 1 },
    control(spec),
    { key: 'a0', kind: 'assistant-step', anchorSeq: 10, turn: 1, step: 0, blocks: [{ kind: 'reasoning', text: 'think needle-alpha' }] },
    { key: 't0', kind: 'tool-call', anchorSeq: 12, turn: 1, root: { kind: 'tool-result', callId: 'c1', call: { name: 'bash', argsRaw: '{}' }, content: [], isError: false } },
  ];
  if (error) nodes.push({ key: 'e0', kind: 'turn-error', anchorSeq: 30, turn: 1 });
  if (limit) nodes.push({ key: 'm0', kind: 'turn-max-tokens', anchorSeq: 30, turn: 1 });
  nodes.push({ key: 'tail', kind: 'turn-tail', anchorSeq: 31, turn: 1 });
  return { sessionId, historyIncomplete: true, compactTranscript: true, nodes, turns: [{ turn: 1, status: 'closed', spec }] };
}

function answerModel(historyIncomplete) {
  const spec = SPEC({ answerAnchorSeq: 20, answerStep: 1, inlineReasoning: true, messageCount: 1, toolCallCount: 1 });
  return {
    sessionId: 's1', historyIncomplete, compactTranscript: true,
    nodes: [
      { key: 'u1', kind: 'user', anchorSeq: 1, turn: 1 },
      control(spec),
      { key: 'a0', kind: 'assistant-step', anchorSeq: 10, turn: 1, step: 0, blocks: [{ kind: 'reasoning', text: 'think part' }] },
      { key: 't0', kind: 'tool-call', anchorSeq: 12, turn: 1, root: { kind: 'tool-result', callId: 'c1', call: { name: 'bash', argsRaw: '{}' }, content: [], isError: false } },
      { key: 'a1', kind: 'assistant-step', anchorSeq: 20, turn: 1, step: 1, blocks: [{ kind: 'reasoning', text: 'final think' }, { kind: 'text', text: 'final answer' }] },
      { key: 'tp', kind: 'turn-process', anchorSeq: 11, turn: 1 },
      { key: 'tail', kind: 'turn-tail', anchorSeq: 21, turn: 1 },
    ],
    turns: [{ turn: 1, status: 'closed', spec }],
  };
}

async function openPage(t, { beforeApply } = {}) {
  const page = await browser.newPage({ reducedMotion: 'no-preference' });
  t.after(() => page.close());
  await page.route('http://fold.test/', route => route.fulfill({ contentType: 'text/html', body: PAGE }));
  await page.goto('http://fold.test/');
  await page.addScriptTag({ path: harnessPath });
  await page.evaluate(() => {
    window.__ModuleLoader__ = {
      load({ id, factory }) {
        if (id !== 'dsh-web-low-motion') throw new Error('Unexpected module id');
        window.plugin = factory(platform => {
          if (platform === 'react') return window.__harness.react;
          if (platform === 'react/jsx-runtime') return window.__harness.jsxRuntime;
          if (platform === 'react-dom') return window.__harness.reactDom;
          if (platform === '@deepseek-ai/dsh-client-store') {
            return { createSnapshotStore(initial) {
              let state = initial;
              const listeners = new Set();
              return {
                getSnapshot: () => state,
                set(next) { state = next; for (const listener of listeners) listener(); },
                subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
              };
            } };
          }
          if (platform === '@deepseek-ai/dsh-client-ui-primitives') return {};
          throw new Error('Unexpected platform import: ' + platform);
        });
      },
    };
  });
  await page.addScriptTag({ content: pluginBundle });
  await page.evaluate(() => {
    window.foldCtx = window.__harness.install();
    window.warnings = [];
    const warn = console.warn;
    console.warn = (...args) => { window.warnings.push(args.map(String).join(' ')); warn(...args); };
  });
  if (beforeApply !== undefined) await page.evaluate(beforeApply);
  await page.evaluate(() => { window.plugin.apply(window.foldCtx, {}); window.__harness.runPendingInjections(); });
  return page;
}

const header = '[data-dsh-turn-fold-header]';
const proxyContent = '[data-dsh-turn-fold-content]';
const smothered = '[data-dsh-turn-fold-tool-hidden]';
const settled = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

test('a closed turn without a final answer folds its process behind one control row', async (t) => {
  const page = await openPage(t);
  await page.evaluate(model => window.__harness.publish(model), noAnswerModel());
  await page.waitForSelector(header);
  await settled(page);
  assert.equal(await page.locator(header).count(), 1);
  assert.match(await page.locator(header).innerText(), /Ended without a final answer/);
  assert.match(await page.locator(header).innerText(), /1 tool call/);
  assert.match(await page.locator(header).innerText(), /1 earlier reply/);
  // The childless assistant-step is proxied; tool-call is NOT shadowed.
  assert.equal(await page.locator('[data-dsh-turn-fold-node][data-dsh-turn-fold-state="collapsed"]').count(), 1);
  assert.equal(await page.evaluate(() => window.__harness.countShadow('tool-call')), 0);
  assert.equal(await page.evaluate(() => window.__harness.countShadow('assistant-step')), 1);
  // The native tool root carries this plugin's own searchable hidden mark.
  assert.equal(await page.locator(smothered + '[hidden="until-found"]').count(), 1);
  assert.equal(await page.locator('[data-native="tool-call"]').first().evaluate(el => el.getBoundingClientRect().height), 0);
  assert.equal(await page.evaluate(() => window.find('needle-alpha')), true);
  // beforematch on either container expands the whole turn.
  await page.locator(smothered).evaluate(el => el.dispatchEvent(new Event('beforematch')));
  await page.waitForFunction(sel => document.querySelectorAll(sel + '[hidden="until-found"]').length === 0, proxyContent);
  assert.equal(await page.locator('[data-native="toolview"]').textContent(), 'bash run c1');
  assert.equal(await page.locator(smothered).count(), 0, 'revealed marks are withdrawn');
  await page.locator(header).click();
  await page.waitForFunction(sel => document.querySelectorAll(sel + '[hidden="until-found"]').length === 1, smothered);
  assert.equal(await page.locator('[data-dsh-turn-fold-node][data-dsh-turn-fold-state="collapsed"]').count(), 1);
});

test('error and limit turns say so, and a running or evidence-free turn has no control', async (t) => {
  const page = await openPage(t);
  await page.evaluate(model => window.__harness.publish(model), noAnswerModel({ error: true }));
  await page.waitForSelector(header);
  assert.match(await page.locator(header).innerText(), /Ended with an error · no final answer/);
  await page.evaluate(model => window.__harness.publish(model), noAnswerModel({ limit: true }));
  await page.waitForFunction(() => /limit/.test(document.querySelector('[data-dsh-turn-fold-header]')?.textContent ?? ''));
  const running = noAnswerModel();
  running.turns[0].status = 'open';
  await page.evaluate(model => window.__harness.publish(model), running);
  await settled(page);
  assert.equal(await page.locator(header).count(), 0);
  assert.equal(await page.locator(smothered).count(), 0, 'running turns are untouched');
  const empty = {
    sessionId: 's1', historyIncomplete: true, compactTranscript: true,
    nodes: [{ key: 'u1', kind: 'user', anchorSeq: 1, turn: 1 }, { key: 'e0', kind: 'turn-error', anchorSeq: 5, turn: 1 }],
    turns: [{ turn: 1, status: 'closed', spec: SPEC() }],
  };
  await page.evaluate(model => window.__harness.publish(model), empty);
  await settled(page);
  assert.equal(await page.locator(header).count(), 0);
});

test('native-controlled turns stay untouched, and a fallback takeover keeps the choice', async (t) => {
  const page = await openPage(t);
  await page.evaluate(model => window.__harness.publish(model), answerModel(false));
  await page.waitForSelector('[data-native="turn-process"]');
  await settled(page);
  assert.equal(await page.locator(header).count(), 0, 'no duplicate control while native owns the turn');
  assert.equal(await page.locator('[data-chat-flow-kind="tool-call"][hidden]').count(), 1);
  await page.locator('[data-native="turn-process"]').click();
  await settled(page);
  assert.equal(await page.locator('[data-chat-flow-kind="tool-call"][hidden]').count(), 0);
  await page.evaluate(model => window.__harness.publish(model), answerModel(true));
  await page.waitForSelector(header);
  await settled(page);
  assert.equal(await page.locator(header).count(), 1);
  assert.equal(await page.locator(proxyContent + '[hidden="until-found"]').count(), 0, 'inherited the expanded choice');
  assert.equal(await page.locator('[data-native-text]').textContent(), 'final answer');
  assert.equal(await page.locator('[data-native-reasoning][data-hidden]').count(), 0, 'an expanded turn keeps its reasoning visible');
  // Collapse through this plugin, then hand back to a native-controlled window.
  await page.locator(header).click();
  await page.waitForFunction(sel => document.querySelectorAll(sel + '[hidden="until-found"]').length === 1, proxyContent);
  assert.equal(await page.locator('[data-native-reasoning][data-hidden]').textContent(), 'final think');
  await page.evaluate(model => window.__harness.publish(model), answerModel(false));
  await page.waitForSelector('[data-native="turn-process"]');
  await settled(page);
  assert.equal(await page.locator('[data-native="turn-process"][data-open]').count(), 0, 'stored collapse bridged into the native store');
  assert.equal(await page.locator('[data-chat-flow-kind="tool-call"][hidden]').count(), 1);
});

test('long history folds an answer-bearing turn and keeps only its reasoning hidden', async (t) => {
  const page = await openPage(t);
  await page.evaluate(model => window.__harness.publish(model), answerModel(true));
  await page.waitForSelector(header);
  await settled(page);
  assert.match(await page.locator(header).innerText(), /Finished turn/);
  assert.equal(await page.locator(proxyContent + '[hidden="until-found"]').count(), 1);
  assert.equal(await page.locator(smothered + '[hidden="until-found"]').count(), 1);
  assert.equal(await page.locator('[data-native-text]').textContent(), 'final answer');
  await page.waitForFunction(() => document.querySelector('[data-native-reasoning][data-hidden]') !== null);
  assert.equal(await page.locator('[data-native-reasoning][data-hidden]').textContent(), 'final think');
});

test('disabling the preference restores native markup and re-enabling registers once', async (t) => {
  const page = await openPage(t);
  await page.evaluate(model => window.__harness.publish(model), noAnswerModel());
  await page.waitForSelector(header);
  await page.evaluate(() => { window.__harness.settingsEntry().inject().setFoldEnabled(false); });
  await settled(page);
  assert.equal(await page.locator(header).count(), 0);
  assert.equal(await page.locator('style[data-dsh-turn-fold]').count(), 0);
  assert.equal(await page.locator(smothered).count(), 0, 'owned marks removed');
  assert.equal(await page.locator('[data-dsh-turn-fold-node][data-dsh-turn-fold-state]').count(), 0);
  assert.equal(await page.locator('[data-native="toolview"]').count(), 1);
  await page.evaluate(() => window.__harness.settingsEntry().inject().setFoldEnabled(true));
  await page.waitForSelector(header);
  await settled(page);
  assert.equal(await page.locator(header).count(), 1);
  assert.equal(await page.evaluate(() => window.__harness.countShadow('assistant-step')), 1);
});

test('manual disclosure is isolated per session for the same turn number', async (t) => {
  const page = await openPage(t);
  await page.evaluate(model => window.__harness.publish(model), noAnswerModel());
  await page.waitForSelector(header);
  await page.locator(header).click();
  await page.waitForFunction(sel => document.querySelectorAll(sel + '[hidden="until-found"]').length === 0, proxyContent);
  await page.evaluate(model => window.__harness.publish(model), noAnswerModel({ sessionId: 's2' }));
  await page.waitForFunction(sel => document.querySelectorAll(sel + '[hidden="until-found"]').length === 1, proxyContent);
  assert.equal(await page.locator(header).getAttribute('aria-expanded'), 'false');
  await page.evaluate(model => window.__harness.publish(model), noAnswerModel({ sessionId: 's1' }));
  await page.waitForFunction(sel => document.querySelectorAll(sel + '[hidden="until-found"]').length === 0, proxyContent);
  assert.equal(await page.locator(header).getAttribute('aria-expanded'), 'true');
});

test('another fold implementation at a non-zero priority makes this plugin back off', async (t) => {
  const page = await openPage(t, {
    beforeApply: () => {
      window.__harness.core.register(
        { name: 'conversation.chat.node', key: 'assistant-step', priority: -1, locale: 'chat' },
        () => null,
      );
    },
  });
  await page.evaluate(model => window.__harness.publish(model), noAnswerModel());
  await settled(page);
  assert.equal(await page.locator(header).count(), 0);
  assert.equal(await page.evaluate(() => window.__harness.countShadow('assistant-step')), 1, 'only the foreign shadow');
});

test('a still-pending tool call is never folded, and focus keeps a closing turn open', async (t) => {
  const page = await openPage(t);
  const pending = noAnswerModel();
  pending.nodes.find(node => node.key === 't0').root = { callId: 'c1', name: 'bash', argsRaw: '{}' };
  await page.evaluate(model => window.__harness.publish(model), pending);
  await page.waitForSelector(header);
  await settled(page);
  assert.equal(await page.locator(smothered).count(), 0, 'a running tool root stays visible');
  assert.equal(await page.locator('[data-native="toolview"]').isVisible(), true);
  // Neutral wrapper keeps the native subtree mounted while the turn closes.
  const running = noAnswerModel();
  running.turns[0].status = 'open';
  await page.evaluate(model => window.__harness.publish(model), running);
  await settled(page);
  assert.equal(await page.locator('[data-dsh-turn-fold-node][data-dsh-turn-fold-state="open"]').count(), 1, 'proxied row keeps a neutral, mounted wrapper while running');
  await page.locator('[data-focus-probe]').first().focus();
  await page.evaluate(model => window.__harness.publish(model), noAnswerModel());
  await settled(page);
  assert.equal(await page.locator(proxyContent + '[hidden="until-found"]').count(), 0, 'focus exemption reveals instead of hiding');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-focus-probe') !== null), true);
});

test('a manual expansion survives the answer boundary appearing on the same turn', async (t) => {
  const page = await openPage(t);
  await page.evaluate(model => window.__harness.publish(model), noAnswerModel());
  await page.waitForSelector(header);
  await page.locator(header).click();
  await page.waitForFunction(sel => document.querySelectorAll(sel + '[hidden="until-found"]').length === 0, proxyContent);
  // The same Turn gains a finalized answer (native still ineligible): the
  // reader's intent must not snap back to collapsed.
  await page.evaluate(model => window.__harness.publish(model), answerModel(true));
  await page.waitForSelector(header);
  await settled(page);
  assert.match(await page.locator(header).innerText(), /Finished turn/);
  assert.equal(await page.locator(header).getAttribute('aria-expanded'), 'true');
  assert.equal(await page.locator(proxyContent + '[hidden="until-found"]').count(), 0);
});

test('without an available control the answer reasoning is never hidden', async (t) => {
  const page = await openPage(t);
  const model = answerModel(true);
  // No control helper node: the Definition/fiber is unavailable (e.g. missing
  // uiConversation). Proxies must pass the native turnProcess straight through.
  model.nodes = model.nodes.filter(node => node.kind !== 'web-low-motion-turn-fold');
  await page.evaluate(next => window.__harness.publish(next), model);
  await settled(page);
  assert.equal(await page.locator(header).count(), 0);
  assert.equal(await page.locator('[data-native-reasoning][data-hidden]').count(), 0, 'no hidden reasoning without a control row');
  assert.equal(await page.locator('[data-native-text]').textContent(), 'final answer');
});

test('an explicit fallback collapse is consumed once so a native click works first try', async (t) => {
  const page = await openPage(t);
  await page.evaluate(model => window.__harness.publish(model), answerModel(true));
  await page.waitForSelector(header);
  // Fallback opens, then the reader explicitly collapses it.
  await page.locator(header).click();
  await page.waitForFunction(sel => document.querySelectorAll(sel + '[hidden="until-found"]').length === 0, proxyContent);
  await page.locator(header).click();
  await page.waitForFunction(sel => document.querySelectorAll(sel + '[hidden="until-found"]').length >= 1, proxyContent);
  // Hand the same turn to the native controller (its open state defaults false).
  await page.evaluate(model => window.__harness.publish(model), answerModel(false));
  await page.waitForSelector('[data-native="turn-process"]');
  await settled(page);
  await page.locator('[data-native="turn-process"]').click();
  await settled(page);
  assert.equal(await page.locator('[data-native="turn-process"][data-open]').count(), 1, 'the native click is not reverted by a stale explicit intent');
  assert.equal(await page.locator('[data-chat-flow-kind="tool-call"][hidden]').count(), 0);
});

test('a foreign shadow on a watched cell appearing later makes the plugin yield and re-register', async (t) => {
  const page = await openPage(t);
  await page.evaluate(model => window.__harness.publish(model), noAnswerModel());
  await page.waitForSelector(header);
  // Another fold plugin claims tool-call (folded here through the DOM bridge):
  // the whole feature yields rather than mixing two controllers.
  await page.evaluate(() => { window.__foreign = window.__harness.foreign('tool-call', -1); });
  await page.waitForFunction(() => document.querySelectorAll('[data-dsh-turn-fold-header]').length === 0);
  await page.evaluate(() => window.__foreign());
  await page.waitForSelector(header);
  assert.equal(await page.locator(header).count(), 1, 'yield is reversible when the foreign entry leaves');
});

test('the control row shrinks inside a 360px viewport without losing the full status text', async (t) => {
  const page = await openPage(t);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.evaluate(model => window.__harness.publish(model), noAnswerModel({ error: true }));
  await page.waitForSelector(header);
  await settled(page);
  const box = await page.locator(header).evaluate(element => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    title: element.getAttribute('title'),
    aria: element.getAttribute('aria-label'),
    fonts: getComputedStyle(element).fontSize,
  }));
  assert.ok(box.clientWidth <= 360, 'header stays inside the viewport');
  assert.ok(box.scrollWidth <= box.clientWidth + 1, 'content shrinks instead of overflowing');
  assert.ok(box.documentScrollWidth <= 360, 'page never scrolls horizontally');
  assert.match(box.title, /Ended with an error · no final answer · 1 tool call · 1 earlier reply/);
  assert.match(box.aria, /Ended with an error · no final answer · 1 tool call · 1 earlier reply/);
  assert.equal(box.fonts, '14px');
});

test('a running question stays visible while a settled question folds like any finished process', async (t) => {
  const page = await openPage(t);
  const running = noAnswerModel();
  running.nodes.find(node => node.key === 't0').root = { callId: 'q1', name: 'ask_user_question', argsRaw: '{}' };
  await page.evaluate(model => window.__harness.publish(model), running);
  await page.waitForSelector(header);
  await settled(page);
  assert.equal(await page.locator(smothered).count(), 0, 'a waiting question is never folded');
  const answered = noAnswerModel();
  answered.nodes.find(node => node.key === 't0').root = {
    kind: 'tool-result', callId: 'q1', call: { name: 'ask_user_question', argsRaw: '{}' }, content: [], isError: false,
  };
  await page.evaluate(model => window.__harness.publish(model), answered);
  await settled(page);
  assert.equal(await page.locator(smothered + '[hidden="until-found"]').count(), 1, 'an answered/cancelled question folds');
});

test('the shipped bundle adds no timer-driven polling', () => {
  assert.ok(!/setInterval/.test(pluginBundle), 'no interval polling');
  assert.ok(!/setTimeout/.test(pluginBundle), 'no timeout scheduling');
});