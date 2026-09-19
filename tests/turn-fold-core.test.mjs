import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DELEGATED_KINDS, TURN_FOLD_KIND, TURN_PROCESS_INDEPENDENT_KINDS, createTurnFoldStore,
  deriveTurnFold, foldGeneration, inProcessRange, nodeFoldRole, planForTurn, processCounts,
  sameKeyList, turnFoldDefinition, turnFoldEligible,
} from '../src/turn-fold-core.js';

function spec(overrides = {}) {
  return {
    turn: 3, controlAnchorSeq: 10, processStartSeq: 5,
    answerAnchorSeq: null, answerStep: null, inlineReasoning: false,
    messageCount: 0, toolCallCount: 0, subagentCount: 0, ...overrides,
  };
}

function roster(entries) {
  const map = new Map(entries.map(([key, kind, anchorSeq, step]) => [key, { kind, anchorSeq, step }]));
  return { keys: [...map.keys()], meta: key => map.get(key) };
}

const user = ['u1', 'user', 1];
const base = { enabled: true, nativeFoldable: false, turnClosed: true, turnStartSeq: 1 };

test('a closed answer-bearing turn folds only its process, keeping the answer', () => {
  const r = roster([user, ['a0', 'assistant-step', 10], ['t0', 'tool-call', 12], ['a1', 'assistant-step', 20, 1], ['tail', 'turn-tail', 21]]);
  const plan = deriveTurnFold({ ...base, spec: spec({ answerAnchorSeq: 20, answerStep: 1, messageCount: 1, toolCallCount: 1 }), keys: r.keys, meta: r.meta });
  assert.equal(plan.reason, 'process');
  assert.equal(plan.hasFinalAnswer, true);
  assert.deepEqual(plan.proxyKeys, ['a0']);
  assert.deepEqual(plan.smotherKeys, ['t0']);
  assert.equal(plan.answerKey, 'a1');
  assert.deepEqual(plan.counts, { tools: 1, replies: 1, subagents: 0, total: 2 });
  const s = spec({ answerAnchorSeq: 20, answerStep: 1 });
  assert.equal(nodeFoldRole({ kind: 'assistant-step', anchorSeq: 20, data: { step: 1 } }, s), 'answer');
  assert.equal(nodeFoldRole({ kind: 'turn-tail', anchorSeq: 21 }, s), 'independent');
});

test('a closed turn without a final answer folds every definite process node', () => {
  for (const [reason, extra] of [['noAnswer', {}], ['error', { error: true }], ['limit', { limit: true }]]) {
    const r = roster([
      user, ['a0', 'assistant-step', 10], ['c0', 'context', 11],
      ...(extra.error ? [['e0', 'turn-error', 30]] : []),
      ...(extra.limit ? [['m0', 'turn-max-tokens', 30]] : []),
      ['tail', 'turn-tail', 31],
    ]);
    const plan = deriveTurnFold({ ...base, spec: spec({ messageCount: 1 }), keys: r.keys, meta: r.meta });
    assert.equal(plan.reason, reason, reason);
    assert.equal(plan.hasFinalAnswer, false);
    assert.deepEqual(plan.proxyKeys, ['a0', 'c0']);
    assert.ok(!plan.processKeys.includes('tail'));
  }
});

test('tool-only and reasoning-only turns still get a fold plan', () => {
  const toolOnly = roster([user, ['t0', 'tool-call', 10]]);
  const p1 = deriveTurnFold({ ...base, spec: spec({ toolCallCount: 1 }), keys: toolOnly.keys, meta: toolOnly.meta });
  assert.deepEqual(p1.smotherKeys, ['t0']);
  assert.deepEqual(p1.proxyKeys, []);
  const reasoningOnly = roster([user, ['a1', 'assistant-step', 20, 1]]);
  const p2 = deriveTurnFold({
    ...base, spec: spec({ answerAnchorSeq: 20, answerStep: 1, inlineReasoning: true, messageCount: 0 }),
    keys: reasoningOnly.keys, meta: reasoningOnly.meta,
  });
  assert.equal(p2.reason, 'reasoning');
  assert.equal(p2.answerKey, 'a1');
  assert.equal(p2.counts.total, 0);
});

test('eligibility uses the authoritative turn start and never folds open or native turns', () => {
  const r = roster([user, ['a0', 'assistant-step', 10]]);
  const inputs = { enabled: true, nativeFoldable: false, turnClosed: true, turnStartSeq: 1, spec: spec({ messageCount: 1 }) };
  assert.equal(turnFoldEligible(inputs), true);
  assert.equal(turnFoldEligible({ ...inputs, turnClosed: false }), false);
  assert.equal(turnFoldEligible({ ...inputs, nativeFoldable: true }), false);
  assert.equal(turnFoldEligible({ ...inputs, enabled: false }), false);
  // A truncated head Turn has no turn.start: not locally provable.
  assert.equal(turnFoldEligible({ ...inputs, turnStartSeq: undefined }), false);
  assert.equal(deriveTurnFold({ ...inputs, turnStartSeq: undefined, keys: r.keys, meta: r.meta }), null);
});

test('no evidence means no control node, but a no-answer control anchor still folds', () => {
  const r = roster([user, ['a1', 'assistant-step', 20, 1], ['tail', 'turn-tail', 21]]);
  const plan = deriveTurnFold({ ...base, spec: spec({ answerAnchorSeq: 20, answerStep: 1 }), keys: r.keys, meta: r.meta });
  assert.equal(plan, null, 'pure-text final with no process folds nothing');
  assert.equal(processCounts(spec()).total, 0);
  // no answer boundary: counts and inlineReasoning are both 0 in the native
  // spec, yet the published control anchor proves the last pure-reasoning step.
  const reasoningOnly = roster([user, ['a0', 'assistant-step', 10]]);
  const plan2 = deriveTurnFold({ ...base, spec: spec(), keys: reasoningOnly.keys, meta: reasoningOnly.meta });
  assert.notEqual(plan2, null);
  assert.equal(plan2.reason, 'noAnswer');
  assert.deepEqual(plan2.proxyKeys, ['a0']);
  // a loaded control node is never counted as process evidence
  const withHelper = roster([user, ['tf', 'web-low-motion-turn-fold', 9.95], ['a0', 'assistant-step', 10]]);
  const plan3 = deriveTurnFold({ ...base, spec: spec(), keys: withHelper.keys, meta: withHelper.meta });
  assert.deepEqual(plan3.processKeys, ['a0']);
});

test('the shared projection is cached per key array and input signature', () => {
  const r = roster([user, ['a0', 'assistant-step', 10]]);
  const inputs = { ...base, spec: spec({ messageCount: 1 }), keys: r.keys, meta: r.meta };
  const first = planForTurn(inputs);
  const second = planForTurn(inputs);
  assert.equal(first, second, 'same key array and inputs share one projection');
  const changed = planForTurn({ ...inputs, nativeFoldable: true });
  assert.equal(changed, null);
  assert.notEqual(changed, first);
});

test('process range and independent kinds match the shipped rules', () => {
  const s = spec({ answerAnchorSeq: 20, answerStep: 1 });
  assert.equal(inProcessRange(5, s), true);
  assert.equal(inProcessRange(19, s), true);
  assert.equal(inProcessRange(20, s), false);
  assert.equal(inProcessRange(4, s), false);
  assert.equal(inProcessRange(undefined, s), false);
  for (const kind of TURN_PROCESS_INDEPENDENT_KINDS) {
    assert.equal(nodeFoldRole({ kind, anchorSeq: 12 }, s), 'independent', kind);
  }
  assert.equal(nodeFoldRole({ kind: 'tool-call', anchorSeq: 12 }, s), 'process');
});

test('sameKeyList compares the full structure, not just its ends', () => {
  assert.equal(sameKeyList(['a', 'b', 'c'], ['a', 'x', 'c']), false);
  assert.equal(sameKeyList(['a', 'b'], ['a', 'b']), true);
  assert.equal(sameKeyList([], []), true);
  assert.equal(sameKeyList(['a'], ['a', 'b']), false);
});

test('manual disclosure is isolated per session and turn, migrates across generations', () => {
  const store = createTurnFoldStore();
  assert.equal(store.has('s1', 3), false);
  assert.equal(store.isOpen('s1', 3, 'no-answer', false), false);
  store.setOpen('s1', 3, 'no-answer', true);
  assert.equal(store.has('s1', 3), true);
  assert.equal(store.isOpen('s2', 3, 'no-answer', false), false);
  // A read is side-effect free AND keeps the reader's intent when the Turn's
  // answer boundary appears later (generation is metadata, not isolation).
  assert.equal(store.isOpen('s1', 3, 'answer-20', false), true);
  // The controller hand-off can also write the carried choice explicitly.
  store.mirror('s1', 3, 'answer-20', true);
  assert.equal(store.isOpen('s1', 3, 'answer-20', false), true);
  assert.equal(store.size(), 1);
  // A mirrored default creates no entry at all (perf: no init storm).
  store.mirror('s9', 9, 'no-answer', false);
  assert.equal(store.has('s9', 9), false);
  // Per-Turn subscriptions: one Turn's expansion never wakes another Turn.
  let own = 0;
  let other = 0;
  const offOwn = store.subscribe('s1', 3, () => { own += 1; });
  const offOther = store.subscribe('s1', 4, () => { other += 1; });
  store.setOpen('s1', 3, 'answer-20', false);
  assert.equal(own, 1);
  assert.equal(other, 0);
  offOwn();
  offOther();
  store.clear();
  assert.equal(store.has('s1', 3), false);
});

test('the control Definition emits one node per closed evidence-bearing turn only', () => {
  assert.equal(turnFoldDefinition.kind, TURN_FOLD_KIND);
  assert.equal(turnFoldDefinition.target, 'chat');
  const turnStart = { seq: 1, time: 1 };
  const location = { kind: 'turn', turn: { turn: 4, status: 'closed', start: turnStart, data: { get: key => (key === 'turn-process' ? spec({ turn: 4, toolCallCount: 1 }) : undefined) } } };
  const context = { key: 'k', id: 'i', start: { location }, matches: [{ location }] };
  const node = turnFoldDefinition.buildViewNode(context);
  assert.equal(node.kind, TURN_FOLD_KIND);
  assert.equal(node.target, 'chat');
  assert.equal(node.anchorSeq, 10 - 0.05);
  assert.equal(node.data.toolCallCount, 1);
  const openLocation = { kind: 'turn', turn: { turn: 4, status: 'open', start: turnStart, data: { get: () => spec({ toolCallCount: 1 }) } } };
  assert.equal(turnFoldDefinition.buildViewNode({ key: 'k', id: 'i', start: { location: openLocation }, matches: [] }), null);
  // A single-step pure-text final has no evidence: no control node.
  const pureText = { kind: 'turn', turn: { turn: 4, status: 'closed', start: turnStart, data: { get: () => spec({ answerAnchorSeq: 20, answerStep: 1 }) } } };
  assert.equal(turnFoldDefinition.buildViewNode({ key: 'k', id: 'i', start: { location: pureText }, matches: [] }), null);
  // No answer boundary + a published control anchor proves definite process.
  const noAnswer = { kind: 'turn', turn: { turn: 4, status: 'closed', start: turnStart, data: { get: () => spec({ turn: 4 }) } } };
  const truncated = { kind: 'turn', turn: { turn: 4, status: 'closed', data: { get: () => spec({ turn: 4 }) } } };
  assert.equal(turnFoldDefinition.buildViewNode({ key: 'k', id: 'i', start: { location: truncated }, matches: [] }), null, 'truncated head turn has no control');
  assert.notEqual(turnFoldDefinition.buildViewNode({ key: 'k', id: 'i', start: { location: noAnswer }, matches: [] }), null);
  assert.deepEqual(turnFoldDefinition.match({ type: 'turn/start', data: { turn: 4 } }), { id: '4', role: 'start' });
  assert.equal(turnFoldDefinition.match({ type: 'turn/end', data: { turn: 4 } }).role, 'update');
  assert.equal(turnFoldDefinition.match({ type: 'assistant/live-chunk', data: { turn: 4 } }), null, 'no per-token subscription');
  assert.equal(turnFoldDefinition.match({ type: 'session/open', data: {} }), null);
});

test('per-Turn subscriptions and the shared projection stay O(turn), not O(T*rows)', () => {
  const store = createTurnFoldStore();
  const notified = new Map();
  const offs = [];
  for (let turn = 1; turn <= 300; turn += 1) {
    notified.set(turn, 0);
    offs.push(store.subscribe('s1', turn, () => notified.set(turn, (notified.get(turn) ?? 0) + 1)));
  }
  store.setOpen('s1', 150, 'no-answer', true);
  assert.equal(notified.get(150), 1);
  assert.equal([...notified.entries()].filter(([turn]) => turn !== 150).reduce((sum, [, count]) => sum + count, 0), 0);
  store.setOpen('s1', 150, 'no-answer', false);
  assert.equal(notified.get(150), 2);
  for (const off of offs) off();

  // One projection scan per stable key array/signature, however many rows ask.
  const entries = [['u1', 'user', 1], ['a0', 'assistant-step', 10], ['t0', 'tool-call', 12]];
  const map = new Map(entries.map(([key, kind, anchorSeq]) => [key, { kind, anchorSeq }]));
  const keys = entries.map(([key]) => key);
  let scans = 0;
  const meta = key => { scans += 1; return map.get(key); };
  const inputs = { enabled: true, nativeFoldable: false, turnClosed: true, turnStartSeq: 1, spec: spec({ toolCallCount: 1 }), keys, meta };
  const first = planForTurn(inputs);
  const second = planForTurn(inputs);
  assert.equal(first, second);
  assert.equal(scans, keys.length, 'one scan for all rows of the Turn');
});

test('a recorded turn/end reason names stop/error/limit without inventing one', () => {
  const r = roster([user, ['a0', 'assistant-step', 10]]);
  const inputs = { ...base, spec: spec(), keys: r.keys, meta: r.meta };
  assert.equal(deriveTurnFold({ ...inputs, endKind: 'aborted' }).reason, 'stopped');
  assert.equal(deriveTurnFold({ ...inputs, endKind: 'error' }).reason, 'error');
  assert.equal(deriveTurnFold({ ...inputs, endKind: 'max-tokens' }).reason, 'limit');
  assert.equal(deriveTurnFold({ ...inputs, endKind: 'something-new' }).reason, 'noAnswer');
  assert.equal(deriveTurnFold(inputs).reason, 'noAnswer');
  const answered = roster([user, ['a0', 'assistant-step', 10], ['a1', 'assistant-step', 20, 1]]);
  const plan = deriveTurnFold({
    ...base, endKind: 'aborted', spec: spec({ answerAnchorSeq: 20, answerStep: 1, messageCount: 1 }),
    keys: answered.keys, meta: answered.meta,
  });
  assert.equal(plan.reason, 'process');
});

test('the proxy set is exactly the childless shipped renderers', () => {
  assert.deepEqual(Object.keys(DELEGATED_KINDS).sort(), [
    'assistant-step', 'compaction', 'context', 'manual-compaction', 'model-retry',
  ]);
  assert.equal(foldGeneration(spec()), 'no-answer');
  assert.equal(foldGeneration(spec({ answerAnchorSeq: 20, answerStep: 1 })), 'answer-20');
});
