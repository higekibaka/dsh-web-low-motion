/**
 * React layer for the Turn-fold half.
 *
 * - Childless shipped process renderers (\`assistant-step\`, \`context\`, ...)
 *   are shadowed and delegated with an owned inner container that carries
 *   \`hidden="until-found"\` while collapsed. The shipped seat's own \`hidden\`
 *   attribute is never written.
 * - \`tool-call\` is NOT shadowed (it owns the \`tool.call.toolview\` child slot).
 *   Its native root element is instead marked with this plugin's own
 *   \`hidden="until-found"\` + data marker, re-applied through a direct-child
 *   MutationObserver while the Turn is a closed fallback window.
 * - One independent \`turn-fold\` node per finished Turn hosts the control row
 *   and is the single place that computes the Turn projection.
 */
import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore,
} from 'react';
import {
  DELEGATED_KINDS, SHADOW_PRIORITY, TURN_FOLD_KIND, foldGeneration, nodeFoldRole,
  planForTurn, sameKeyList, turnFoldEligible,
} from './turn-fold-core.js';
import { createToolFoldDOM } from './turn-fold-dom.js';

const SLOT = 'conversation.chat.node';

/**
 * Control readiness belongs to one rendered column. The same session may be
 * visible in main and sidebar views: neither view may hide content because a
 * button exists only in its sibling, or clear its sibling on unmount.
 */
const readinessColumns = new WeakMap();
const readinessKey = (sessionId, turn) => String(sessionId) + '\u0000' + String(turn);
function readinessRecord(ref, sessionId, turn, create = false) {
  const column = ref.current?.closest('[data-chat-flow]');
  if (!column || sessionId === undefined || turn === undefined) return undefined;
  let turns = readinessColumns.get(column);
  if (!turns && create) readinessColumns.set(column, turns = new Map());
  if (!turns) return undefined;
  const key = readinessKey(sessionId, turn);
  let record = turns.get(key);
  if (!record && create) {
    record = { owners: 0, listeners: new Set(), release() {
      if (this.owners === 0 && this.listeners.size === 0) turns.delete(key);
    } };
    turns.set(key, record);
  }
  return record;
}
function retainControl(ref, sessionId, turn) {
  const record = readinessRecord(ref, sessionId, turn, true);
  if (!record) return undefined;
  record.owners += 1;
  if (record.owners === 1) for (const listener of [...record.listeners]) listener();
  return () => {
    record.owners -= 1;
    if (record.owners === 0) for (const listener of [...record.listeners]) listener();
    record.release();
  };
}

/** Subscribe after the proxy ref attaches, then recheck the local control. */
function useControlReady(ref, sessionId, turn) {
  return useSyncExternalStore(
    useCallback(listener => {
      const record = readinessRecord(ref, sessionId, turn, true);
      if (!record) return () => {};
      record.listeners.add(listener);
      return () => { record.listeners.delete(listener); record.release(); };
    }, [ref, sessionId, turn]),
    useCallback(() => (readinessRecord(ref, sessionId, turn)?.owners ?? 0) > 0, [ref, sessionId, turn]),
  );
}

function turnOf(node) {
  const location = node === undefined ? undefined : node.location;
  return location !== undefined && (location.kind === 'turn' || location.kind === 'step')
    ? location.turn.turn
    : undefined;
}

/** Own searchable hidden state (never the shipped seat). */
function useOwnSearchableHidden(ref, hidden, reveal) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    if (hidden && element.contains(element.ownerDocument.activeElement)) {
      reveal();
      return;
    }
    if (hidden) element.setAttribute('hidden', 'until-found');
    else element.removeAttribute('hidden');
  }, [hidden, reveal]);
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    element.addEventListener('beforematch', reveal);
    return () => { element.removeEventListener('beforematch', reveal); };
  }, [hidden, reveal]);
}

/** Manual state subscription for one Turn. */
function useFoldOpen(store, sessionId, turn, generation) {
  return useSyncExternalStore(
    useCallback(listener => (sessionId === undefined || turn === undefined
      ? () => {}
      : store.subscribe(sessionId, turn, listener)), [store, sessionId, turn]),
    useCallback(() => store.isOpen(sessionId, turn, generation, false), [store, sessionId, turn, generation]),
  );
}

/**
 * Hand one Turn's disclosure between controllers without losing the reader's
 * choice: push a stored choice into the native store, otherwise adopt the
 * native one into this plugin's store.
 */
function useNativeDisclosureBridge(store, sessionId, turn, generation, turnProcess, nativeFoldable) {
  const nativeOpen = turnProcess === undefined ? undefined : turnProcess.open;
  const setNativeOpen = turnProcess === undefined ? undefined : turnProcess.setOpen;
  useEffect(() => {
    if (!nativeFoldable || sessionId === undefined || turn === undefined || setNativeOpen === undefined) return;
    // Only an explicit fallback choice is pushed into the native store; a
    // mirrored native value must never fight the reader's native interaction.
    if (store.hasExplicit(sessionId, turn)) {
      const wanted = store.isOpen(sessionId, turn, generation, false);
      if (nativeOpen !== wanted) setNativeOpen(wanted);
      // Consume the intent on the unified path even when no native write was
      // needed, or the next native click would be reverted once.
      store.mirror(sessionId, turn, generation, wanted);
      return;
    }
    store.mirror(sessionId, turn, generation, nativeOpen === true);
  }, [nativeFoldable, sessionId, turn, generation, nativeOpen, setNativeOpen, store]);
}

/** The one control row of a fallback-controlled Turn. */
function TurnFoldHeader({ plan, open, onToggle, tFold }) {
  const parts = [];
  if (plan.counts.tools > 0) parts.push(tFold(plan.counts.tools === 1 ? 'toolOne' : 'tools', { count: plan.counts.tools }));
  if (plan.counts.replies > 0) parts.push(tFold(plan.counts.replies === 1 ? 'replyOne' : 'replies', { count: plan.counts.replies }));
  if (plan.counts.subagents > 0) parts.push(tFold(plan.counts.subagents === 1 ? 'subagentOne' : 'subagents', { count: plan.counts.subagents }));
  if (parts.length === 0) parts.push(tFold('reasoningOnly'));
  // Ellipsis must never hide the status: the full composed text stays available
  // as the tooltip and inside the accessible name.
  const fullText = [tFold(plan.reason), ...parts].join(' \u00b7 ');
  return (
    <button
      type="button"
      className="dsh-turn-fold-header"
      data-dsh-turn-fold-header=""
      data-open={open || undefined}
      aria-expanded={open}
      title={fullText}
      aria-label={fullText + ' \u2014 ' + tFold(open ? 'collapse' : 'expand')}
      onClick={event => { event.currentTarget.focus(); onToggle(); }}
    >
      <span className="dsh-turn-fold-chevron" aria-hidden="true" />
      <span className="dsh-turn-fold-title">{tFold(plan.reason)}</span>
      <span className="dsh-turn-fold-detail">{parts.join(' \u00b7 ')}</span>
    </button>
  );
}

/** Shadow component for one childless shipped Node renderer. */
function createProxyView(kind, nativeEntry, store) {
  const Native = nativeEntry.component;
  function TurnFoldProxyView(props) {
    const { node, turnProcess, useChat, sessionId } = props;
    const turn = turnOf(node);
    const status = useChat(snapshot => (turn === undefined ? undefined : snapshot.timeline.turns.get(turn)?.status));
    const startSeq = useChat(snapshot => (turn === undefined ? undefined : snapshot.timeline.turns.get(turn)?.start?.seq));
    const spec = turnProcess === undefined ? undefined : turnProcess.spec;
    const nativeFoldable = turnProcess !== undefined && turnProcess.foldable === true;
    const generation = spec === undefined ? '' : foldGeneration(spec);
    const open = useFoldOpen(store, sessionId, turn, generation);
    const contentRef = useRef(null);
    const ready = useControlReady(contentRef, sessionId, turn);
    const eligible = turnFoldEligible({
      enabled: true, nativeFoldable, turnClosed: status === 'closed', turnStartSeq: startSeq, spec,
    });
    const role = spec === undefined ? 'other' : nodeFoldRole(node, spec);
    const collapsed = eligible && ready && role === 'process' && !open;
    const reveal = useCallback(() => {
      if (sessionId === undefined || turn === undefined || generation === '') return;
      store.setOpen(sessionId, turn, generation, true);
    }, [store, sessionId, turn, generation]);
    useOwnSearchableHidden(contentRef, collapsed, reveal);
    // Native find/reveal inside the final answer must drive the plugin's own
    // state in a fallback window, or the answer would expand while its sibling
    // process rows stayed folded.
    const setOpen = value => {
      if (sessionId === undefined || turn === undefined || generation === '') return;
      store.setOpen(sessionId, turn, generation, value);
    };
    // Only an active fallback window may rewrite the answer owner; a running,
    // truncated, native-controlled, or not-yet-ready turn passes the native
    // turnProcess straight through (no hidden reasoning without a control).
    const delegated = eligible && ready && role === 'answer' && spec.inlineReasoning === true
      ? { ...turnProcess, foldable: true, open, setOpen }
      : turnProcess;
    // The wrapper is ALWAYS present: a native subtree is never unmounted and
    // remounted when eligibility/readiness changes, so focus is preserved and
    // the focus exemption can still see the active element.
    return (
      <div
        className="dsh-turn-fold-node"
        data-dsh-turn-fold-node=""
        data-dsh-turn-fold-state={collapsed ? 'collapsed' : 'open'}
      >
        <div ref={contentRef} className="dsh-turn-fold-content" data-dsh-turn-fold-content="">
          <Native {...props} turnProcess={delegated} />
        </div>
      </div>
    );
  }
  TurnFoldProxyView.displayName = 'TurnFoldProxy(' + kind + ')';
  return TurnFoldProxyView;
}

/** Independent control row + the single per-Turn projection pass. */
function createControlView(store, tFold) {
  function TurnFoldControlView(props) {
    const { node, turnProcess, useChat, sessionId } = props;
    const spec = node === undefined ? undefined : node.data;
    const turn = spec !== undefined && typeof spec.turn === 'number' ? spec.turn : turnOf(node);
    const snapshotRef = useRef(undefined);
    const keys = useChat(snapshot => {
      snapshotRef.current = snapshot;
      return turn === undefined ? undefined : snapshot.locations.getTurn(turn);
    }, sameKeyList);
    const status = useChat(snapshot => (turn === undefined ? undefined : snapshot.timeline.turns.get(turn)?.status));
    const startSeq = useChat(snapshot => (turn === undefined ? undefined : snapshot.timeline.turns.get(turn)?.start?.seq));
    const nativeFoldable = turnProcess !== undefined && turnProcess.foldable === true;
    const plan = useMemo(() => {
      const snapshot = snapshotRef.current;
      if (snapshot === undefined || keys === undefined || spec === undefined) return null;
      const meta = key => {
        const candidate = snapshot.nodes.get(key);
        if (candidate === undefined || candidate === null) return undefined;
        const step = candidate.kind === 'assistant-step' && candidate.data !== undefined && candidate.data !== null
          ? candidate.data.step
          : undefined;
        return { kind: candidate.kind, anchorSeq: candidate.anchorSeq, step };
      };
      return planForTurn({
        enabled: true, nativeFoldable, turnClosed: status === 'closed', turnStartSeq: startSeq,
        endKind: spec.endKind, spec, keys, meta,
      });
    }, [keys, status, startSeq, nativeFoldable, spec]);
    const generation = plan !== null ? plan.generation : spec === undefined ? '' : foldGeneration(spec);
    const open = useFoldOpen(store, sessionId, turn, generation);
    // Single bridge writer: the independent control mounts even inside a hidden
    // native parent, so proxies never race each other over the native store.
    useNativeDisclosureBridge(store, sessionId, turn, generation, turnProcess, nativeFoldable);
    const rootRef = useRef(null);
    useLayoutEffect(() => {
      const owns = plan !== null && !nativeFoldable && turnProcess !== undefined;
      return owns ? retainControl(rootRef, sessionId, turn) : undefined;
    }, [sessionId, turn, plan, nativeFoldable, turnProcess]);
    const reveal = useCallback(() => {
      if (sessionId === undefined || turn === undefined || generation === '') return;
      store.setOpen(sessionId, turn, generation, true);
    }, [store, sessionId, turn, generation]);
    const smotherActive = plan !== null && !nativeFoldable && plan.smotherKeys.length > 0 && !open;
    useLayoutEffect(() => {
      const anchor = rootRef.current;
      if (anchor === null || !smotherActive) return undefined;
      let controller;
      try {
        controller = createToolFoldDOM({ anchor, turn, reveal });
      } catch {
        // A composition this bridge does not recognize fails open: the rows are
        // left exactly as the shipped renderer produced them.
        return undefined;
      }
      const snapshot = snapshotRef.current;
      const nodes = plan.smotherKeys.map(key => {
        const candidate = snapshot === undefined ? undefined : snapshot.nodes.get(key);
        const root = candidate === undefined || candidate.data === undefined ? undefined : candidate.data.root;
        if (root === undefined) return undefined;
        // Conservative exemption: an unsettled root (no final result) may still
        // wait for user interaction, so it stays visible. A settled root is a
        // static transcript (answered/cancelled/aborted question included) and
        // folds like any other finished process.
        if (!('kind' in root)) return undefined;
        return { key, callId: root.callId };
      }).filter(node => node !== undefined && node.callId !== undefined);
      controller.update({ nodes, collapsed: true });
      return () => { controller.dispose(); };
    }, [smotherActive, plan, turn, reveal]);
    if (turnProcess === undefined || nativeFoldable || plan === null) return null;
    const onToggle = () => {
      if (sessionId === undefined || turn === undefined) return;
      store.setOpen(sessionId, turn, generation, !open);
    };
    return (
      <div
        ref={rootRef}
        className="dsh-turn-fold-control"
        data-dsh-turn-fold-control=""
        data-dsh-turn-fold-state={open ? 'open' : 'collapsed'}
      >
        <TurnFoldHeader plan={plan} open={open} onToggle={onToggle} tFold={tFold} />
      </div>
    );
  }
  TurnFoldControlView.displayName = 'TurnFoldControl';
  return TurnFoldControlView;
}

/**
 * Register the proxy shadows, the independent control row, and (through the
 * caller) the conversation Definition. Backs off per key when another entry
 * already took a non-zero priority, with a diagnostic.
 */
/** Normalize any Cordis/Slot disposable shape into a plain function. */
export function asDisposer(value) {
  if (typeof value === 'function') return value;
  if (value !== null && typeof value === 'object') {
    if (typeof value.dispose === 'function') return () => { value.dispose(); };
    if (typeof value[Symbol.dispose] === 'function') return () => { value[Symbol.dispose](); };
  }
  return undefined;
}

/** Process kinds other fold implementations may claim instead of a proxy cell. */
const WATCHED_KINDS = [...Object.keys(DELEGATED_KINDS), 'tool-call', 'turn-process'];

export function registerTurnFold(ctx, options) {
  const { store, tFold, definition } = options;
  const slots = ctx.slots;
  const nativeIds = new WeakMap();
  const ownComponents = new Set();
  let nextNativeId = 0;
  const nativeIdOf = entry => {
    let id = nativeIds.get(entry);
    if (id === undefined) {
      id = nextNativeId++;
      nativeIds.set(entry, id);
    }
    return id;
  };
  let disposers = [];
  let diagnostics = [];
  let disposed = false;
  // The Definition source and its renderer share one lifetime: yielding the
  // renderer without dropping the source would leave helper nodes rendering the
  // shipped unknown-surface fallback (raw spec JSON) instead of nothing.
  let definitionDispose;
  const ensureDefinition = () => {
    if (definition === undefined || definitionDispose !== undefined) return;
    definitionDispose = registerTurnFoldDefinition(ctx, definition);
  };
  const dropDefinition = () => {
    if (definitionDispose === undefined) return;
    const dispose = definitionDispose;
    definitionDispose = undefined;
    dispose();
  };
  const disposeAll = () => {
    for (const dispose of disposers.splice(0)) {
      try { dispose(); } catch { /* already disposed by the plugin lifecycle */ }
    }
  };
  const rosterOf = () => {
    try {
      return [...slots.entries(SLOT)];
    } catch {
      return null;
    }
  };
  // A foreign claim is any non-zero priority entry this registrar did not
  // create (component identity, never a display name). The watched set includes
  // the cells we fold through the DOM bridge so a plugin that only shadows
  // tool-call/turn-process still makes us yield.
  const foreignFor = (roster, kind) => roster.find(entry => entry.options.key === kind
    && (entry.options.priority ?? 0) !== 0
    && !ownComponents.has(entry.component));
  const signatureOf = roster => {
    if (roster === null) return 'unavailable';
    const parts = [];
    for (const kind of WATCHED_KINDS) {
      const sameKey = roster.filter(entry => entry.options.key === kind);
      const native = sameKey.find(entry => (entry.options.priority ?? 0) === 0);
      const foreign = foreignFor(roster, kind);
      parts.push(kind + ':' + (native === undefined ? '-' : nativeIdOf(native)) + ':'
        + (foreign === undefined ? '-' : String(foreign.options.priority ?? 0)));
    }
    return parts.join('|');
  };
  const register = (kind, priority, component, locale) => {
    ownComponents.add(component);
    try {
      disposers.push(slots.inject(SLOT, () => slots.register({
        name: SLOT, key: kind, priority, ...(locale === undefined ? {} : { locale }),
      }, component)));
      return true;
    } catch (error) {
      diagnostics.push({ kind, code: 'register-failed', message: String(error && error.message) });
      return false;
    }
  };
  const evaluate = () => {
    disposeAll();
    diagnostics = [];
    const roster = rosterOf();
    if (roster === null) {
      diagnostics.push({ kind: '*', code: 'roster-unavailable' });
      return;
    }
    let occupied = false;
    for (const kind of WATCHED_KINDS) {
      const foreign = foreignFor(roster, kind);
      if (foreign !== undefined) {
        diagnostics.push({ kind, code: 'occupied', priority: foreign.options.priority ?? 0 });
        occupied = true;
      }
    }
    if (occupied) {
      dropDefinition();
      return;
    }
    for (const kind of Object.keys(DELEGATED_KINDS)) {
      const sameKey = roster.filter(entry => entry.options.key === kind);
      const native = sameKey.find(entry => (entry.options.priority ?? 0) === 0);
      if (native === undefined) {
        diagnostics.push({ kind, code: 'missing-native' });
        continue;
      }
      let priority = SHADOW_PRIORITY;
      while (sameKey.some(entry => (entry.options.priority ?? 0) === priority)) priority -= 1;
      register(kind, priority, createProxyView(kind, native, store), DELEGATED_KINDS[kind]);
    }
    const controlRegistered = register(TURN_FOLD_KIND, 0, createControlView(store, tFold));
    // A helper node must never exist without its renderer.
    if (controlRegistered) ensureDefinition();
    else dropDefinition();
  };
  const report = () => {
    if (diagnostics.length > 0 && typeof console !== 'undefined' && console.warn) {
      console.warn('dsh-web-low-motion: turn-fold registration notes', diagnostics);
    }
  };
  evaluate();
  report();
  let signature = signatureOf(rosterOf());
  let unsubscribe;
  if (typeof slots.subscribe === 'function') {
    // Late native entries, replacements, and foreign priorities re-evaluate the
    // whole decision; our own registrations leave the fingerprint unchanged.
    let scheduled = false;
    unsubscribe = slots.subscribe(SLOT, () => {
      if (disposed || scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        // A dispose during the queue window cancels the pending re-registration.
        if (disposed) return;
        const next = signatureOf(rosterOf());
        if (next === signature) return;
        signature = next;
        evaluate();
        report();
      });
    });
  }
  return {
    get diagnostics() { return diagnostics; },
    dispose() {
      disposed = true;
      if (typeof unsubscribe === 'function') unsubscribe();
      unsubscribe = undefined;
      disposeAll();
      dropDefinition();
    },
  };
}

/**
 * Register the independent control Definition with the conversation engine.
 * Optional service: absent uiConversation only disables the control rows.
 */
export function registerTurnFoldDefinition(ctx, definition) {
  // Cordis lifecycle injection waits for the service instead of losing the
  // feature on a first miss; the fallback covers harnesses without ctx.inject.
  if (typeof ctx.inject === 'function') {
    // Cordis inject returns a Fiber (PromiseLike), NOT a disposer: the apply
    // body's returned effect owns the registration, and our cleanup disposes
    // the fiber. Disposing before re-enabling keeps a fast toggle from
    // registering the same Definition twice.
    let disposed = false;
    let fiber;
    try {
      fiber = ctx.inject(['uiConversation'], scope => {
        if (disposed) return () => {};
        const off = scope.uiConversation.events.register(definition);
        const dispose = asDisposer(off);
        return () => { if (dispose !== undefined) dispose(); };
      });
    } catch (error) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('dsh-web-low-motion: uiConversation injection failed', error);
      }
      return undefined;
    }
    return () => {
      if (disposed) return;
      disposed = true;
      if (fiber !== null && typeof fiber === 'object' && typeof fiber.dispose === 'function') {
        try { fiber.dispose(); } catch { /* already unloaded */ }
        return;
      }
      // PromiseLike-only fallback: settle first, then dispose whatever it yields.
      Promise.resolve(fiber).then(
        value => { const dispose = asDisposer(value); if (dispose !== undefined) dispose(); },
        () => {},
      );
    };
  }
  const uiConversation = typeof ctx.get === 'function' ? ctx.get('uiConversation') : undefined;
  if (uiConversation === undefined || uiConversation === null || uiConversation.events === undefined) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('dsh-web-low-motion: uiConversation service unavailable; turn-fold control rows disabled');
    }
    return undefined;
  }
  return asDisposer(uiConversation.events.register(definition));
}

export { createProxyView, createControlView };