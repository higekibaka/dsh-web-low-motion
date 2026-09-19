/**
 * Real-host harness entry for the Turn-fold plugin tests.
 *
 * Everything host-shaped here is REAL and imported from the local DSH checkout:
 * Cordis Context, ui-renderer SlotRegistry + createSlotRenderer (scoped-slots),
 * React 18 / ReactDOM 18, and the shipped business components
 * (ChatNodeSeat, AssistantNodeView, TurnProcessNodeView, ToolCallTree, BashRow).
 * Only data doubles are test-owned: the root/session standard-source bindings,
 * the locale dictionaries, the chat node/process sources, and the tool-call
 * payloads. No slot runtime, Hook kit, ownership check, or error boundary is
 * reimplemented here.
 */
import * as React from 'react';
import { useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { Context } from '@host/cordis';
import { SlotRegistry } from '@host/ui-renderer/registry';
import { createSlotRenderer } from '@host/ui-renderer/scoped-slots';
import { ChatNodeSeat } from '@host/ui-chat/ChatNodeSeat';
import { AssistantNodeView } from '@host/ui-chat/AssistantNodeView';
import { TurnProcessNodeView } from '@host/ui-chat/TurnProcessNodeView';
import { createChatStore } from '@host/ui-chat/stores';
import { useTurnDataValue } from '@host/ui-chat/use-turn-data';
import { ToolCallTree } from '@host/ui-tool/ToolCallTree';
import { bashToolviewSample } from '@host/ui-tool/bash';
import chatViewCss from '@host/ui-chat/ChatView.module.css';
import { createTurnFoldStore, turnFoldDefinition, TURN_FOLD_KIND } from '../src/turn-fold-core.js';
import { registerTurnFold, registerTurnFoldDefinition } from '../src/turn-fold-view.jsx';
import { TURN_FOLD_NAMESPACE } from '../src/turn-fold-locale.js';

const SLOT = 'conversation.chat.node';
const VIEW_SLOT = 'host.chatview';

/* ------------------------------------------------------------ host state */

const listeners = new Set();
const emptyMap = new Map();
let model = {
  order: [],
  nodes: emptyMap,
  process: emptyMap,
  compactTranscript: true,
  historyIncomplete: false,
  turnData: emptyMap,
};

function subscribe(listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function getState() { return model; }
function notify() { for (const listener of [...listeners]) listener(); }

/** Chat snapshot projection over the harness model (session binding data). */
function makeChatSnapshot(current) {
  const turns = new Map();
  for (const node of current.nodes.values()) {
    const location = node === undefined ? undefined : node.location;
    if (location === undefined || (location.kind !== 'turn' && location.kind !== 'step')) continue;
    const turn = location.turn.turn;
    if (!turns.has(turn)) {
      turns.set(turn, {
        turn,
        status: location.turn.status === undefined ? 'open' : location.turn.status,
        start: { seq: 0, time: 1 },
        end: undefined,
        steps: [],
      });
    }
  }
  return {
    order: current.order,
    nodes: { get: key => current.nodes.get(key) },
    locations: {
      getTurn: turn => current.order.filter(key => {
        const node = current.nodes.get(key);
        const location = node === undefined ? undefined : node.location;
        return location !== undefined && (location.kind === 'turn' || location.kind === 'step')
          && location.turn.turn === turn;
      }),
      getStep: () => [],
    },
    timeline: { turnOrder: [...turns.keys()], turns },
    navigation: { items: () => [] },
  };
}

let chatSnapshot = makeChatSnapshot(model);
const chatSource = {
  getSnapshot: () => chatSnapshot,
  subscribe: listener => subscribe(listener),
};

function setModel(next) {
  // Host turn data is an object; alpha.2 caches hook contexts in a WeakMap.
  if (next.nodes) for (const node of next.nodes.values()) {
    const turn = node?.location?.turn;
    if (turn && turn.data == null) turn.data = turnDataStore(new Map());
  }
  model = { ...model, ...next };
  chatSnapshot = makeChatSnapshot(model);
  notify();
}
function useModel() { return useSyncExternalStore(subscribe, getState); }
function useNode(key) { return useSyncExternalStore(subscribe, () => model.nodes.get(key)); }
function useProcess(key) { return useSyncExternalStore(subscribe, () => model.process.get(key)); }

/* --------------------------------------------------------- data doubles */

const DICT = {
  chat: {
    'message.think': 'Think', 'row.running': 'Running', 'message.unknownSurface': 'Unknown {type}',
    'json.truncated': 'Truncated {total}', 'message.turnProcess.thoughtForAWhile': 'Thought for a while',
    'message.turnProcess.separator': ', ',
    'message.turnProcess.toolCalls.one': '{count} tool call', 'message.turnProcess.toolCalls.other': '{count} tool calls',
    'message.turnProcess.messages.one': '{count} message', 'message.turnProcess.messages.other': '{count} messages',
    'message.turnProcess.subagents.one': '{count} subagent', 'message.turnProcess.subagents.other': '{count} subagents',
  },
  conversation: {
    'tool.title.bash': 'Bash', 'tool.title.read': 'Read', 'tool.title.search': 'Search',
    'tool.title.write': 'Write', 'tool.title.edit': 'Edit', 'tool.title.code': 'Code', 'tool.title.generic': 'Tool',
    'bash.running': 'Running', 'bash.failed': 'Failed', 'bash.stopped': 'Stopped',
    'row.input': 'Input', 'row.output': 'Output', 'row.inspect': 'Inspect',
  },
  [TURN_FOLD_NAMESPACE]: {
    expand: 'Expand this finished turn', collapse: 'Collapse this finished turn', process: 'Finished turn',
    reasoning: 'Finished turn \u00b7 final answer kept', stopped: 'Stopped without a final answer',
    noAnswer: 'Ended without a final answer', error: 'Ended with an error \u00b7 no final answer',
    limit: 'Stopped at the limit \u00b7 no final answer',
    toolOne: '1 tool call', tools: '{count} tool calls',
    replyOne: '1 earlier reply', replies: '{count} earlier replies',
    subagentOne: '1 subagent', subagents: '{count} subagents',
    reasoningOnly: 'reasoning only', region: 'Finished turn process',
  },
};

function translate(namespace, key, params) {
  const dict = DICT[namespace] ?? {};
  const raw = dict[key] ?? key;
  return params === undefined ? raw : raw.replace(/\{(\w+)\}/g, (_match, name) => String(params[name]));
}

const localeFace = {
  getSnapshot: () => ({ revision: 1 }),
  subscribe: () => () => {},
  bind: namespace => (key, params) => translate(namespace, key, params),
};

const sessionsSource = {
  getSnapshot: () => ({ byId: { s1: { cwd: '/work/project' } } }),
  subscribe: () => () => {},
};
const hostInfoSource = {
  getSnapshot: () => ({ home: '/home/tester' }),
  subscribe: () => () => {},
};

const sessionBinding = {
  key: 's1',
  hooks: { chat: chatSource },
  keyedHooks: {},
  props: { sessionId: 's1' },
};

function turnDataStore(values) {
  return {
    get: key => values.get(key),
    source: key => ({
      getSnapshot: () => values.get(key),
      subscribe: () => () => {},
    }),
  };
}

/**
 * Build the control helper through the REAL conversation Definition so the
 * field contract is never copied into the test.
 */
function buildControlNode(input) {
  const definition = input.definition === undefined ? turnFoldDefinition : input.definition;
  const values = new Map([['turn-process', input.spec]]);
  const turnObject = {
    turn: input.turn,
    status: input.status === undefined ? 'closed' : input.status,
    steps: [],
    start: { seq: input.startSeq === undefined ? 0 : input.startSeq },
    end: input.endKind === undefined ? undefined : { data: { reason: { kind: input.endKind } } },
    data: turnDataStore(values),
  };
  const location = { kind: 'step', turn: turnObject, step: { step: 0 } };
  const context = {
    key: input.key === undefined ? 'fold-' + input.turn : input.key,
    id: String(input.turn),
    start: { location },
    matches: [
      { event: { type: 'turn/start', data: { turn: input.turn } }, location },
      { event: { type: 'turn/end', data: { turn: input.turn, reason: { kind: input.endKind } } }, location },
    ],
    current: new Map(input.previous === undefined ? [] : [['chat', input.previous]]),
  };
  return definition === undefined || definition === null ? null : definition.buildViewNode(context);
}

/* ------------------------------------------------------------ components */

const CHAT_NODE_INJECT = {
  hooks: {
    turnData: (_standard, data) => function useTurnData(key) {
      return useTurnDataValue(data, key);
    },
  },
};

const ViewOptions = React.createContext({ omitControl: false });

function HostChatView(props) {
  const { renderSlot, useStore, actions, t } = props;
  const state = useModel();
  const { omitControl } = React.useContext(ViewOptions);
  return (
    <div className={chatViewCss.column + " host-chat-flow"} data-host-chat="" data-chat-flow="">
      {state.order.filter(key => !omitControl || state.nodes.get(key)?.kind !== TURN_FOLD_KIND).map(nodeKey => (
        <ChatNodeSeat
          key={nodeKey}
          nodeKey={nodeKey}
          useChatNode={useNode}
          useChatNodeProcess={useProcess}
          historyIncomplete={state.historyIncomplete}
          compactTranscript={state.compactTranscript}
          cwd="/work/project"
          openFile={() => {}}
          inspectCall={() => {}}
          forkAt={() => {}}
          loadImage={Object.assign(() => Promise.resolve(''), { peek: () => undefined })}
          renderMessageImages={() => null}
          fileMentions={() => undefined}
          useStore={useStore}
          actions={actions}
          renderSlot={renderSlot}
          t={t}
        />
      ))}
    </div>
  );
}

function RootFrame({ renderSlot }) {
  return renderSlot(VIEW_SLOT, {});
}

/* --------------------------------------------------------------- wiring */

let ctx;
let slots;
let foldRegistration;
let bashApplied = false;
const nativeDisposers = [];

function registerNative() {
  nativeDisposers.push(slots.register({
    name: 'root',
    children: { [VIEW_SLOT]: { kind: 'single', scope: 'root' } },
  }, RootFrame));
  nativeDisposers.push(slots.register({
    name: VIEW_SLOT,
    locale: 'chat',
    store: createChatStore,
    children: { [SLOT]: { kind: 'keyed', scope: 'session', inject: CHAT_NODE_INJECT } },
  }, HostChatView));
  nativeDisposers.push(slots.register({ name: SLOT, key: 'assistant-step', locale: 'chat' }, AssistantNodeView));
  nativeDisposers.push(slots.register({ name: SLOT, key: 'turn-process', locale: 'chat' }, TurnProcessNodeView));
  nativeDisposers.push(slots.register({
    name: SLOT,
    key: 'tool-call',
    locale: 'conversation',
    children: { 'tool.call.toolview': { kind: 'keyed', scope: 'session' } },
    inject: () => ({ hooks: { hostInfo: hostInfoSource } }),
  }, ToolCallTree));
  if (!bashApplied) {
    bashApplied = true;
    bashToolviewSample.apply(ctx);
  }
}

function releaseNative() {
  while (nativeDisposers.length > 0) nativeDisposers.pop()();
}

async function boot() {
  const container = document.getElementById('root');
  ctx = new Context();
  sessionBinding.ctx = ctx;
  const fiber = ctx.plugin(SlotRegistry);
  await fiber.await();
  slots = ctx.get('slots');
  if (slots === undefined) throw new Error('host: SlotRegistry did not provide slots');
  slots.install(createSlotRenderer());
  slots.installLocale(localeFace);
  slots.provideRoot({ hooks: { sessions: sessionsSource } });
  slots.installScope('session', {
    current: { getSnapshot: () => sessionBinding, subscribe: () => () => {} },
    resolve: () => ({ ...sessionBinding, ctx }),
    renderArea: (binding, areaProps) => {
      if (binding.key === undefined) return areaProps.empty === undefined ? null : areaProps.empty();
      return <React.Fragment key={binding.key}>{areaProps.children}</React.Fragment>;
    },
  });
  ctx.provide('locale', { register: () => () => {}, bind: localeFace.bind });
  registerNative();
  createRoot(container).render(<>{slots.renderSlot('root', {})}</>);
  return true;
}

function mountFold() {
  if (foldRegistration !== undefined) return false;
  foldRegistration = registerTurnFold(ctx, {
    store: createTurnFoldStore(),
    tFold: localeFace.bind(TURN_FOLD_NAMESPACE),
    definition: turnFoldDefinition,
  });
  return true;
}

function unmountFold() {
  if (foldRegistration === undefined) return false;
  foldRegistration.dispose();
  foldRegistration = undefined;
  return true;
}

function foldDiagnostics() {
  return foldRegistration === undefined ? null : foldRegistration.diagnostics;
}

let conversationSpy = null;

/** Build a helper through the Definition currently held by the conversation probe. */
function registeredHelper(input) {
  if (conversationSpy === null) return null;
  const definition = conversationSpy.registered.find(candidate => candidate !== null
    && typeof candidate === 'object' && candidate.kind === TURN_FOLD_KIND
    && typeof candidate.buildViewNode === 'function');
  if (definition === undefined) return null;
  return buildControlNode({ ...input, definition });
}

/**
 * Publish a model plus the helper node the registered Definition currently
 * emits. Removing the Definition therefore removes the node, exactly as the
 * real conversation engine would.
 */
function publishWithHelper(model, helperInput) {
  const nodes = [...model.nodes];
  const helper = registeredHelper(helperInput);
  if (helper !== null && helper !== undefined) nodes.push(helper);
  const process = new Map((model.process ?? []).map(item => [item.key, item.presentation]));
  if (helper !== null && helper !== undefined) {
    process.set(helper.key, {
      turn: helperInput.turn,
      spec: helperInput.spec,
      turnClosed: true,
      hasExternalProcess: true,
      compactAnswer: true,
    });
  }
  // Real conversation order is anchor sequence, not registration order: the
  // helper sits at firstProcess - 0.05, before the process rows and the answer.
  const ordered = [...nodes].sort((left, right) => (left.anchorSeq ?? 0) - (right.anchorSeq ?? 0));
  setModel({
    order: ordered.map(node => node.key),
    nodes: new Map(ordered.map(node => [node.key, node])),
    process,
    compactTranscript: model.compactTranscript !== false,
    historyIncomplete: model.historyIncomplete === true,
  });
  return helper;
}

/** Provide a spy uiConversation service for Definition registration tests. */
function provideUiConversation() {
  const registered = [];
  const removed = [];
  conversationSpy = { registered, removed };
  ctx.provide('uiConversation', {
    events: {
      register: definition => {
        registered.push(definition);
        return () => {
          removed.push(definition);
          const index = registered.indexOf(definition);
          if (index >= 0) registered.splice(index, 1);
        };
      },
    },
  });
  return { registered, removed };
}

function registerDefinition(definition) {
  return registerTurnFoldDefinition(ctx, definition);
}

function entries() {
  return slots.entries(SLOT).map(entry => ({
    key: entry.options.key,
    priority: entry.options.priority ?? 0,
    registrant: entry.registrant ?? null,
  }));
}

let secondaryRoot;
function mountSecondary(omitControl = false) {
  const container = document.createElement('div');
  container.id = 'secondary';
  document.body.append(container);
  secondaryRoot = createRoot(container);
  secondaryRoot.render(<ViewOptions.Provider value={{ omitControl }}>{slots.renderSlot('root', {})}</ViewOptions.Provider>);
}
function unmountSecondary() {
  secondaryRoot.unmount();
  document.getElementById('secondary').remove();
}

window.__host = {
  mountSecondary,
  unmountSecondary,
  boot,
  setModel,
  mountFold,
  unmountFold,
  foldDiagnostics,
  provideUiConversation,
  registerDefinition,
  buildControlNode,
  registeredHelper,
  publishWithHelper,
  TURN_FOLD_KIND,
  turnFoldDefinition,
  entries,
  registerNative,
  releaseNative,
  get ctx() { return ctx; },
  get slots() { return slots; },
  turnDataStore,
};
