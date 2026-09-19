/**
 * Offline integration harness: real React 18.3.1 + the real shipped
 * `SlotCore` (read-only import from the local DSH checkout), a faithful
 * replica of `ChatNodeSeat`'s verified hidden rules, and a minimal keyed
 * dispatcher matching the shipped renderer's composed-props contract.
 *
 * It is a test fixture only: no DSH server, no model request, no network.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { SlotCore } from '@dsl-slots';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import * as reactDom from 'react-dom';

const SLOT = 'conversation.chat.node';
const INDEPENDENT = new Set(['system-prompt', 'user', 'steering', 'turn-process', 'turn-error', 'turn-max-tokens', 'turn-tail']);
const LOCALE = {
  chat: {}, conversation: {},
  'web-low-motion': {},
  'web-low-motion-turn-fold': {
    expand: 'Expand this finished turn', collapse: 'Collapse this finished turn',
    process: 'Finished turn', noAnswer: 'Ended without a final answer',
    error: 'Ended with an error · no final answer', limit: 'Stopped at the limit · no final answer',
    stepOne: '1 step', steps: '{count} steps', region: 'Finished turn process',
  },
  'web-low-motion-turn-fold-zh': {},
};
for (const key of Object.keys(LOCALE)) LOCALE[key].close = 'Close';

/* ---------------------------------------------------------------- store */

function createObservable(initial) {
  let value = initial;
  const listeners = new Set();
  return {
    getSnapshot: () => value,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set: (next) => { value = next; for (const listener of [...listeners]) listener(); },
  };
}

const store = createObservable(null);
let coreVersion = 0;
const coreListeners = new Set();
const useCoreVersion = () => useSyncExternalStore(
  listener => { coreListeners.add(listener); return () => { coreListeners.delete(listener); }; },
  () => coreVersion,
);
const useStore = selector => {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return selector === undefined ? snapshot : selector(snapshot);
};

/* ---------------------------------------------------------------- slots */

const core = new SlotCore();
core.onMutate(() => {
  coreVersion += 1;
  for (const listener of [...coreListeners]) listener();
});
const entryIds = new WeakMap();
let nextEntryId = 0;
const entryId = entry => {
  let id = entryIds.get(entry);
  if (id === undefined) { id = nextEntryId++; entryIds.set(entry, id); }
  return id;
};

/** Slot-level hook factories declared by slot owners (turnData). */
const slotInject = new Map();

function renderDispatch(key, ownerProps, opts) {
  const winners = core.entriesOfSlot(key);
  if (winners.length === 0) return opts === undefined ? null : opts.fallback ?? null;
  const entry = opts !== undefined && opts.entryKey !== undefined
    ? winners.find(candidate => candidate.options.key === opts.entryKey)
    : winners[0];
  const body = entry === undefined
    ? (opts === undefined ? null : opts.fallback ?? null)
    : <EntryOutlet key={entryId(entry)} entry={entry} ownerProps={ownerProps} opts={opts} />;
  // Mirror the shipped outlet anchor: one [data-slot] wrapper per occurrence.
  return <div data-slot={key} style={{ display: 'contents' }}>{body}</div>;
}

function bindHook(source) {
  return selector => {
    const value = useSyncExternalStore(source.subscribe, source.getSnapshot);
    return selector === undefined ? value : selector(value);
  };
}

function makeTurnDataHook(hookContext) {
  return key => {
    const source = hookContext.source(key);
    return useSyncExternalStore(source.subscribe, source.getSnapshot);
  };
}

function EntryOutlet({ entry, ownerProps, opts }) {
  const snapshot = useStore();
  const kit = {
    sessionId: snapshot.sessionId,
    useChat: useChat,
    useSession: () => undefined,
  };
  if (entry.locale !== undefined) {
    const dict = LOCALE[entry.locale] ?? {};
    kit.t = (key, params) => {
      const raw = dict[key] ?? key;
      return params === undefined ? raw : raw.replace(/\{(\w+)\}/g, (_, name) => String(params[name]));
    };
  }
  const injected = entry.inject === undefined ? {} : entry.inject(snapshot.sessionId);
  if (injected.hooks !== undefined) {
    for (const [name, source] of Object.entries(injected.hooks)) {
      kit['use' + name[0].toUpperCase() + name.slice(1)] = bindHook(source);
    }
  }
  const owner = { ...ownerProps };
  const hookContext = opts === undefined ? undefined : opts.hookContext;
  if (hookContext !== undefined) kit.useTurnData = makeTurnDataHook(hookContext);
  if (entry.children !== undefined) {
    const binding = (key, childOwner, childOpts) => renderDispatch(key, childOwner, childOpts);
    if (Object.values(entry.children).some(spec => spec.kind === 'chain')) kit.renderSlotChain = () => null;
    kit.renderSlot = binding;
  }
  const Component = entry.component;
  return <Component {...kit} {...injected} {...owner} />;
}

function useChat(selector) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return selector === undefined ? snapshot : selector(snapshot);
}

/* ------------------------------------------------------- native replicas */

function AssistantStepView(props) {
  const { node, turnProcess, t } = props;
  const data = node.data;
  const reasoning = (data.blocks ?? []).filter(block => block.kind === 'reasoning');
  const reasoningHidden = turnProcess !== undefined
    && turnProcess.foldable
    && turnProcess.spec.answerStep === data.step
    && turnProcess.spec.inlineReasoning
    && !turnProcess.open;
  return (
    <div data-native="assistant-step" data-step={data.step}>
      {reasoning.map((block, index) => (
        <div key={index} data-native-reasoning="" data-hidden={reasoningHidden || undefined}>{block.text}</div>
      ))}
      {(data.blocks ?? []).filter(block => block.kind === 'text').map((block, index) => (
        <div key={'t' + index} data-native-text="">{block.text}</div>
      ))}
      <button type="button" data-focus-probe="">probe</button>
    </div>
  );
}

const HOST_FACTS = { home: '/home/tester' };
const hostInfo = { getSnapshot: () => HOST_FACTS, subscribe: () => () => {} };

function ToolCallTreeView(props) {
  const { node, renderSlot, useHostInfo, t } = props;
  const home = useHostInfo(info => info.home);
  const block = node.data.root;
  const toolName = 'kind' in block ? (block.call?.name ?? '') : block.name;
  const owner = {
    callId: block.callId, toolName, block, cwd: props.cwd, home,
    openFile: props.openFile ?? (() => {}), loadImage: props.loadImage,
    inspect: () => {},
  };
  return (
    <div data-native="tool-call" data-chat-call-id={block.callId} data-chat-anchor-key={'call:' + block.callId} data-tool={toolName}>
      {renderSlot('tool.call.toolview', owner, { entryKey: toolName, fallback: <div data-native="tool-fallback">fallback</div> })}
    </div>
  );
}

function ToolviewBash(props) {
  return <div data-native="toolview" data-tool="bash">bash run {props.block.callId}</div>;
}

function SimpleView(props) {
  return <div data-native={props.node.kind}>{props.node.kind === 'context' ? 'context body' : props.node.kind} {props.t('close')}</div>;
}

function TurnProcessView(props) {
  const { node, turnProcess } = props;
  if (turnProcess === undefined || !turnProcess.foldable) return null;
  return (
    <button type="button" data-native="turn-process" data-open={turnProcess.open || undefined}
      aria-expanded={turnProcess.open}
      onClick={() => turnProcess.setOpen(!turnProcess.open)}>native process</button>
  );
}

/* --------------------------------------------------------- seat replica */

function useSearchableHidden(hidden, reveal) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    if (hidden && element.contains(element.ownerDocument.activeElement)) { reveal(); return; }
    if (hidden) element.setAttribute('hidden', 'until-found');
    else element.removeAttribute('hidden');
  }, [hidden, reveal]);
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    element.addEventListener('beforematch', reveal);
    return () => element.removeEventListener('beforematch', reveal);
  }, [reveal]);
  return ref;
}

/** Faithful replica of the shipped ChatNodeSeat's disclosure rules. */
function ChatNodeSeat({ nodeKey, compactTranscript, historyIncomplete }) {
  const snapshot = useStore();
  const node = snapshot.nodes.get(nodeKey);
  if (node === undefined) return null;
  const turn = node.location.turn.turn;
  const presentation = snapshot.presentations.get(turn);
  const spec = presentation === undefined ? undefined : presentation.spec;
  const entry = presentation === undefined ? undefined : presentation.openEntry;
  const processOpen = entry !== undefined && spec !== undefined && entry.answerStep === spec.answerStep;
  const processWindowReady = spec !== undefined && presentation !== undefined && compactTranscript
    && spec.answerAnchorSeq !== null
    && presentation.turn === spec.turn && presentation.turnClosed && !historyIncomplete;
  const processMember = processWindowReady && !INDEPENDENT.has(node.kind)
    && node.anchorSeq >= spec.processStartSeq && node.anchorSeq < spec.answerAnchorSeq;
  const processAnswer = processWindowReady && node.kind === 'assistant-step' && node.data.step === spec.answerStep;
  const ownsDisclosure = node.kind === 'turn-process' || processAnswer;
  const foldable = processWindowReady
    && (processMember || (ownsDisclosure && (presentation.hasExternalProcess || spec.inlineReasoning)));
  const turnProcess = useMemo(() => spec === undefined ? undefined : ({
    spec, foldable, open: processOpen,
    setOpen: open => snapshot.setNativeOpen(turn, open),
  }), [spec, foldable, processOpen, snapshot, turn]);
  const controllerInactive = node.kind === 'turn-process' && !foldable;
  const processHidden = controllerInactive || (foldable && processMember && !processOpen);
  const revealProcess = useCallback(() => { if (processMember) turnProcess.setOpen(true); }, [processMember, turnProcess]);
  const wrapperRef = useSearchableHidden(processHidden, revealProcess);
  const owner = {
    cwd: '/tmp', openFile: () => {}, inspectCall: () => {}, forkAt: () => {},
    loadImage: () => Promise.resolve(''), renderMessageImages: () => null, fileMentions: () => undefined,
    turnProcess,
  };
  const turnData = {
    source: key => ({
      getSnapshot: () => snapshot.turnData.get(turn)?.get(key),
      subscribe: () => () => {},
    }),
  };
  return (
    <div ref={wrapperRef} className="flowItem" data-chat-anchor-key={node.key} data-chat-flow-key={node.key}
      data-chat-flow-kind={node.kind} data-chat-turn={turn}
      data-turn-process-member={processMember || undefined} data-turn-process-hidden={processHidden || undefined}>
      {renderDispatch(SLOT, { ...owner, node }, { entryKey: node.kind, hookContext: turnData })}
    </div>
  );
}

function App() {
  useCoreVersion();
  const snapshot = useStore();
  if (snapshot === null) return null;
  return (
    <div className="column" data-chat-flow="">
      {snapshot.order.map(nodeKey => (
        <ChatNodeSeat key={nodeKey} nodeKey={nodeKey}
          compactTranscript={snapshot.compactTranscript} historyIncomplete={snapshot.historyIncomplete} />
      ))}
    </div>
  );
}

/* ------------------------------------------------- snapshot projection */

function project(model) {
  const nodes = new Map(model.nodes.map(node => [node.key, {
    key: node.key,
    kind: node.kind,
    anchorSeq: node.anchorSeq,
    data: node.data !== undefined
      ? node.data
      : node.kind === 'assistant-step'
        ? { step: node.step, blocks: node.blocks ?? [], status: node.status ?? 'settled' }
        : node.kind === 'tool-call' ? { root: node.root } : { step: node.step },
    location: { kind: 'step', turn: { turn: node.turn, status: model.turns.find(turn => turn.turn === node.turn)?.status ?? 'open' }, step: { step: node.step ?? 0 } },
  }]));
  const locations = new Map();
  for (const node of model.nodes) {
    if (!locations.has(node.turn)) locations.set(node.turn, []);
    locations.get(node.turn).push(node.key);
  }
  const presentations = new Map();
  for (const turn of model.turns) {
    const inTurn = model.nodes.filter(node => node.turn === turn.turn);
    const external = inTurn.some(node => !INDEPENDENT.has(node.kind) && node.anchorSeq >= turn.spec.processStartSeq
      && (turn.spec.answerAnchorSeq === null || node.anchorSeq < turn.spec.answerAnchorSeq)
      && !(node.kind === 'assistant-step' && node.step === turn.spec.answerStep));
    presentations.set(turn.turn, {
      turn: turn.turn,
      spec: turn.spec,
      turnClosed: turn.status === 'closed',
      hasExternalProcess: external,
      openEntry: turn.nativeOpen === undefined ? undefined : { turn: turn.turn, answerStep: turn.nativeOpen.answerStep },
    });
  }
  const turnData = new Map();
  for (const turn of model.turns) {
    turnData.set(turn.turn, new Map([['turn-process', turn.spec]]));
  }
  return {
    sessionId: model.sessionId,
    compactTranscript: model.compactTranscript !== false,
    historyIncomplete: model.historyIncomplete === true,
    order: model.nodes.map(node => node.key),
    nodes: {
      get: key => nodes.get(key),
      source: key => ({ getSnapshot: () => nodes.get(key), subscribe: () => () => {} }),
      processSource: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }),
      values: () => [...nodes.values()],
    },
    locations: {
      getTurn: turn => locations.get(turn) ?? [],
      getStep: () => [],
    },
    timeline: { turnOrder: model.turns.map(turn => turn.turn), turns: new Map(model.turns.map(turn => [turn.turn, { turn: turn.turn, status: turn.status, start: { seq: 0, time: 1 }, end: { seq: 99, time: 2 }, steps: new Map() }])) },
    navigation: { items: () => [] },
    legacy: { nodes: [], turnTimings: new Map(), turnEnds: new Map(), partial: null, runningCalls: [] },
    presentations,
    turnData,
    setNativeOpen(turn, open) {
      const target = model.turns.find(candidate => candidate.turn === turn);
      if (target === undefined) return;
      const node = model.nodes.find(candidate => candidate.turn === turn && candidate.kind === 'assistant-step' && candidate.step === target.spec.answerStep);
      target.nativeOpen = open ? { answerStep: target.spec.answerStep } : undefined;
      window.__harness.publish(model);
    },
  };
}

/* ------------------------------------------------------------- context */

function createContext() {
  const disposers = [];
  const pendingInjections = [];
  const settingsEntries = [];
  const slots = {
    register(options, component) {
      const dispose = core.register(options, component);
      if (options.name === 'settings.section') settingsEntries.push({ options, component });
      return dispose;
    },
    inject(name, callback) {
      let active;
      let stopped = false;
      const run = () => {
        if (stopped) return;
        try {
          const result = callback();
          active = typeof result === 'function' ? result : undefined;
        } catch (error) {
          console.error('harness slots.inject failed', name, error);
        }
      };
      if (core.specDynamic(name) !== undefined) run();
      else pendingInjections.push({ name, run });
      return () => {
        if (stopped) return;
        stopped = true;
        const dispose = active;
        active = undefined;
        if (typeof dispose === 'function') dispose();
      };
    },
    entries: name => core.entries(name),
    entriesOfSlot: name => core.entriesOfSlot(name),
    spec: name => core.specDynamic(name),
    subscribe: (name, fn) => core.onMutate(key => { if (key === name) fn(); }),
  };
  const locale = {
    dictionaries: new Map(),
    register(namespace, dictionary) { locale.dictionaries.set(namespace, dictionary); return () => {}; },
    bind(namespace) {
      const registered = locale.dictionaries.get(namespace);
      // DSH dictionaries are per-language records; the fixture resolves 'en'.
      const dict = registered !== undefined && (registered.en !== undefined || registered.zh !== undefined)
        ? (registered.en ?? {})
        : registered ?? {};
      return (key, params) => {
        const raw = dict[key] ?? LOCALE[namespace]?.[key] ?? key;
        return params === undefined ? raw : raw.replace(/\{(\w+)\}/g, (_, name) => String(params[name]));
      };
    },
    getSnapshot: () => ({ revision: 1 }),
    subscribe: () => () => {},
  };
  const ctx = {
    effect(fn) {
      const result = fn();
      disposers.push(typeof result === 'function' ? result : () => {});
      return () => {};
    },
    locale,
    slots,
  };
  return { ctx, dispose() { for (const dispose of disposers.splice(0)) { try { dispose(); } catch { /* ignore */ } } }, slots, settingsEntries, pendingInjections };
}

/* --------------------------------------------------------- declarations */

core.register({
  name: 'root',
  children: {
    [SLOT]: { kind: 'keyed', scope: 'session' },
    'settings.section': { kind: 'single', scope: 'root' },
  },
}, () => null);

core.register({ name: SLOT, key: 'user', locale: 'chat' }, SimpleView);
core.register({ name: SLOT, key: 'assistant-step', locale: 'chat' }, AssistantStepView);
core.register({ name: SLOT, key: 'context', locale: 'chat' }, SimpleView);
core.register({ name: SLOT, key: 'compaction', locale: 'chat' }, SimpleView);
core.register({ name: SLOT, key: 'manual-compaction', locale: 'chat' }, SimpleView);
core.register({ name: SLOT, key: 'model-retry', locale: 'chat' }, SimpleView);
core.register({ name: SLOT, key: 'turn-tail', locale: 'chat' }, SimpleView);
core.register({ name: SLOT, key: 'turn-error', locale: 'chat' }, SimpleView);
core.register({ name: SLOT, key: 'turn-max-tokens', locale: 'chat' }, SimpleView);
core.register({ name: SLOT, key: 'turn-process', locale: 'chat' }, TurnProcessView);
core.register({
  name: SLOT, key: 'tool-call', locale: 'conversation',
  children: { 'tool.call.toolview': { kind: 'keyed', scope: 'session' } },
  inject: () => ({ hooks: { hostInfo } }),
}, ToolCallTreeView);
core.register({ name: 'tool.call.toolview', key: 'bash', locale: 'conversation' }, ToolviewBash);

/* -------------------------------------------------------------- public */

const harness = {
  react: React, reactDom, jsxRuntime,
  core,
  slots: null,
  context: null,
  publish(model) { store.set(project(model)); },
  install() {
    const created = createContext();
    harness.context = created;
    harness.slots = created.slots;
    return created.ctx;
  },
  runPendingInjections() { for (const item of harness.context.pendingInjections.splice(0)) item.run(); },
  settingsEntry() {
    const record = harness.context.settingsEntries.at(-1);
    return record === undefined ? undefined : record.options;
  },
  foreign(kind, priority) {
    return core.register({ name: SLOT, key: kind, priority, locale: kind === 'tool-call' ? 'conversation' : 'chat' }, () => null);
  },
  countNative(kind) { return core.entries(SLOT).filter(entry => entry.options.key === kind && (entry.options.priority ?? 0) === 0).length; },
  countShadow(kind) { return core.entries(SLOT).filter(entry => entry.options.key === kind && (entry.options.priority ?? 0) !== 0).length; },
};

window.__harness = harness;
const root = createRoot(document.getElementById('root'));
root.render(<App />);
