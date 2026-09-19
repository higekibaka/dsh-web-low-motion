/**
 * Pure Turn-fold core: decides which already-closed Turns the shipped UI left
 * unfolded, computes one shared projection per Turn, and owns the manual
 * disclosure state.
 *
 * Nothing here touches React or the DOM, so every rule is exercised by plain
 * node tests. The React layer only renders what these functions return.
 *
 * Verified shipped behaviour (DSH 0.1.5-rc.1):
 * - The seat applies native Turn-process disclosure only when
 *   \`processWindowReady\` holds: compact transcript, a finalized answer
 *   (\`answerAnchorSeq !== null\`), a closed Turn, and \`!historyIncomplete\`.
 *   A Turn that ended without a final answer, and every closed Turn while
 *   older pages remain, are never folded by the native controller.
 * - \`turn.data.get('turn-process')\` still publishes range/counts for those
 *   Turns, so the plugin reuses the native facts instead of re-deriving them.
 */

/** Namespaced Chat node kind of this plugin's own independent control row. */
export const TURN_FOLD_KIND = 'web-low-motion-turn-fold';

/** Synthetic anchor: just after the native (inactive) turn-process control. */
export const TURN_FOLD_ANCHOR_OFFSET = -0.05;

/** Chat Node kinds the shipped seat keeps independent of Turn-process disclosure. */
export const TURN_PROCESS_INDEPENDENT_KINDS = new Set([
  'system-prompt',
  'user',
  'steering',
  'turn-process',
  'turn-error',
  'turn-max-tokens',
  'turn-tail',
]);

/**
 * Shipped keyed Node renderers this plugin may shadow and delegate to, mapped
 * to the locale namespace each native component declares.
 *
 * Every kind here is childless in the shipped registration: the slot core
 * rejects a second declarer for an occupied child key, so an entry that owns
 * children (\`tool-call\`, \`command\`, \`turn-tail\`) is never shadowed.
 * \`tool-call\` rows are folded through an owned attribute on the native root
 * element instead (see \`deriveTurnFold\`'s \`smotherKeys\`), which keeps the
 * native renderer, its child dispatch, and its own hidden ownership untouched.
 */
export const DELEGATED_KINDS = Object.freeze({
  'assistant-step': 'chat',
  'context': 'chat',
  'compaction': 'chat',
  'manual-compaction': 'chat',
  'model-retry': 'chat',
});

/** Registration order of {@link DELEGATED_KINDS}. */
export const DELEGATED_KIND_LIST = Object.freeze(Object.keys(DELEGATED_KINDS));

/** Node kind whose native root is smothered through an owned attribute. */
export const SMOTHER_KIND = 'tool-call';

/** Node renderer overrides sit below the shipped priority 0 and above -1. */
export const SHADOW_PRIORITY = -0.5;

/** Whether one loaded node anchor falls inside the Turn's process window. */
export function inProcessRange(anchorSeq, spec) {
  if (typeof anchorSeq !== 'number' || spec === undefined || spec === null) return false;
  if (anchorSeq < spec.processStartSeq) return false;
  if (spec.answerAnchorSeq !== null && anchorSeq >= spec.answerAnchorSeq) return false;
  return true;
}

/** Role of one Chat node in its Turn's fold. */
export function nodeFoldRole(node, spec) {
  if (node === undefined || node === null || spec === undefined || spec === null) return 'other';
  if (node.kind === TURN_FOLD_KIND || TURN_PROCESS_INDEPENDENT_KINDS.has(node.kind)) return 'independent';
  if (node.kind === 'assistant-step'
    && spec.answerAnchorSeq !== null
    && spec.answerStep !== null
    && node.data !== undefined
    && node.data !== null
    && node.data.step === spec.answerStep) return 'answer';
  return inProcessRange(node.anchorSeq, spec) ? 'process' : 'other';
}

/**
 * Stable generation of one Turn's fold identity: it moves only with the native
 * answer boundary, so a hand-off between the native and fallback controllers
 * migrates the reader's choice instead of dropping it.
 */
export function foldGeneration(spec) {
  return spec.answerAnchorSeq === null ? 'no-answer' : 'answer-' + spec.answerAnchorSeq;
}

/** Evidence counts one Turn's process published. */
export function processCounts(spec) {
  const tools = spec.toolCallCount ?? 0;
  const replies = spec.messageCount ?? 0;
  const subagents = spec.subagentCount ?? 0;
  return { tools, replies, subagents, total: tools + replies + subagents };
}

/**
 * Cheap eligibility test (no loaded-key scan): whether this plugin should own
 * the disclosure of one Turn at all. Used by the per-node proxy wrappers, so
 * the O(turn) projection runs once per Turn in the control row only.
 */
export function turnFoldEligible(input) {
  const { enabled, nativeFoldable, turnClosed, turnStartSeq, spec } = input;
  if (enabled !== true || nativeFoldable === true || turnClosed !== true) return false;
  if (spec === undefined || spec === null) return false;
  // turn.start is authoritative and its presence proves the loaded window
  // covers this Turn's opening (goal Turns legitimately have no user node).
  if (typeof turnStartSeq !== 'number') return false;
  // A null answer boundary with a published control anchor proves definite
  // process even when counts and inlineReasoning are 0 (the native spec forces
  // inlineReasoning false on that branch): the last pure-reasoning/tool step.
  if (spec.answerAnchorSeq === null) return true;
  return processCounts(spec).total > 0 || spec.inlineReasoning === true;
}

/**
 * One shared projection per Turn. The control row is the only caller, so the
 * O(turn) scan never repeats per node; an in-maturity cache keyed by the
 * stable key array and the cheap input signature keeps it to one scan per
 * structural change.
 *
 * @returns plan, or null when the shipped controller already owns the Turn.
 */
export function deriveTurnFold(input) {
  const { enabled, nativeFoldable, turnClosed, turnStartSeq, endKind, spec, keys, meta } = input;
  if (!turnFoldEligible({ enabled, nativeFoldable, turnClosed, turnStartSeq, spec })) return null;
  if (!Array.isArray(keys) || keys.length === 0 || typeof meta !== 'function') return null;
  const processKeys = [];
  const smotherKeys = [];
  const proxyKeys = [];
  let answerKey = null;
  let hasError = false;
  let hasLimit = false;
  for (const key of keys) {
    const item = meta(key);
    if (item === undefined || item === null) continue;
    if (item.kind === 'turn-error') hasError = true;
    else if (item.kind === 'turn-max-tokens') hasLimit = true;
    if (item.kind === TURN_FOLD_KIND || TURN_PROCESS_INDEPENDENT_KINDS.has(item.kind)) continue;
    if (item.kind === 'assistant-step' && spec.answerAnchorSeq !== null && spec.answerStep !== null
      && item.step === spec.answerStep) {
      answerKey = key;
      continue;
    }
    if (!inProcessRange(item.anchorSeq, spec)) continue;
    processKeys.push(key);
    if (item.kind === SMOTHER_KIND) smotherKeys.push(key);
    else if (DELEGATED_KINDS[item.kind] !== undefined) proxyKeys.push(key);
  }
  const counts = processCounts(spec);
  const hasFinalAnswer = spec.answerAnchorSeq !== null && spec.answerStep !== null;
  const hasReasoning = spec.inlineReasoning === true;
  // Nothing this plugin can actually hide => no control row (never an empty fold).
  if (processKeys.length === 0 && !hasReasoning) return null;
  // Never invent a reason: only the recorded turn/end reason kind is used.
  const reason = !hasFinalAnswer
    ? (hasError || endKind === 'error' ? 'error'
      : hasLimit || endKind === 'max-tokens' ? 'limit'
        : endKind === 'aborted' ? 'stopped' : 'noAnswer')
    : counts.total > 0 ? 'process' : 'reasoning';
  return {
    turn: spec.turn,
    processKeys,
    proxyKeys,
    smotherKeys,
    answerKey,
    processCount: processKeys.length,
    counts,
    hasFinalAnswer,
    inlineReasoning: hasReasoning,
    reason,
    generation: foldGeneration(spec),
  };
}

const planCache = new WeakMap();

/**
 * Cache one Turn projection per stable key array and cheap input signature.
 * @param input - {@link deriveTurnFold} inputs.
 * @returns plan, or null.
 */
export function planForTurn(input) {
  const { keys, spec, turnClosed, nativeFoldable, enabled, turnStartSeq, endKind } = input;
  if (!Array.isArray(keys)) return deriveTurnFold(input);
  const signature = [
    enabled === true ? 1 : 0,
    nativeFoldable === true ? 1 : 0,
    turnClosed === true ? 1 : 0,
    typeof turnStartSeq === 'number' ? turnStartSeq : 'x',
    typeof endKind === 'string' ? endKind : 'x',
    spec === undefined || spec === null ? 'x' : [spec.controlAnchorSeq, spec.processStartSeq, spec.answerAnchorSeq, spec.answerStep, spec.inlineReasoning ? 1 : 0, spec.messageCount, spec.toolCallCount, spec.subagentCount].join(','),
  ].join('|');
  let bySignature = planCache.get(keys);
  if (bySignature === undefined) {
    bySignature = new Map();
    planCache.set(keys, bySignature);
  }
  if (bySignature.has(signature)) return bySignature.get(signature);
  const plan = deriveTurnFold(input);
  bySignature.set(signature, plan);
  return plan;
}

/** Full structural equality of two loaded key arrays. */
export function sameKeyList(left, right) {
  if (left === right) return true;
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

/**
 * Per-Session/Turn manual disclosure state. Isolation is
 * \`sessionId + turn + generation\`; a generation move migrates the stored
 * choice inside the write path (reads stay side-effect free), so pagination can
 * hand a Turn between the native and fallback controllers without dropping the
 * reader's choice.
 *
 * Subscriptions are per Turn: expanding one Turn never notifies another Turn's
 * rows, and a mirrored default (absent + collapsed) creates no entry at all.
 */
export function createTurnFoldStore() {
  const entries = new Map();
  const listeners = new Map();
  const keyOf = (sessionId, turn) => String(sessionId) + '\u0000' + String(turn);
  const notify = key => {
    const set = listeners.get(key);
    if (set === undefined) return;
    for (const listener of [...set]) listener();
  };
  const read = (sessionId, turn, _generation, fallback) => {
    if (sessionId === undefined || turn === undefined) return fallback === true;
    const entry = entries.get(keyOf(sessionId, turn));
    if (entry === undefined) return fallback === true;
    // One manual choice per Session+Turn: the generation is source metadata, so
    // a Turn that gains its answer boundary (or changes controller) keeps the
    // reader's intent instead of snapping back to the default.
    return entry.open;
  };
  const write = (sessionId, turn, generation, open, explicit) => {
    if (sessionId === undefined || turn === undefined) return;
    const key = keyOf(sessionId, turn);
    const entry = entries.get(key);
    // The default state is collapsed and non-explicit: never materialize it.
    if (entry === undefined && open !== true && explicit !== true) return;
    if (entry !== undefined && entry.open === (open === true) && entry.explicit === explicit) {
      if (entry.generation !== generation) entries.set(key, { generation, open: entry.open, explicit: entry.explicit });
      return;
    }
    entries.set(key, { generation, open: open === true, explicit });
    notify(key);
  };
  return {
    /**
     * Subscribe to one Turn's manual state.
     * @returns unsubscribe.
     */
    subscribe(sessionId, turn, listener) {
      const key = keyOf(sessionId, turn);
      let set = listeners.get(key);
      if (set === undefined) {
        set = new Set();
        listeners.set(key, set);
      }
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(key);
      };
    },
    has(sessionId, turn) {
      if (sessionId === undefined || turn === undefined) return false;
      return entries.has(keyOf(sessionId, turn));
    },
    /** Whether the reader made an explicit choice in the fallback controller. */
    hasExplicit(sessionId, turn) {
      if (sessionId === undefined || turn === undefined) return false;
      const entry = entries.get(keyOf(sessionId, turn));
      return entry !== undefined && entry.explicit === true;
    },
    isOpen(sessionId, turn, generation, fallback = false) {
      return read(sessionId, turn, generation, fallback);
    },
    setOpen(sessionId, turn, generation, open) {
      write(sessionId, turn, generation, open, true);
    },
    mirror(sessionId, turn, generation, open) {
      write(sessionId, turn, generation, open, false);
    },
    clear() {
      if (entries.size === 0) return;
      const keys = [...listeners.keys()];
      for (const entry of entries.values()) void entry;
      entries.clear();
      for (const key of keys) notify(key);
      listeners.clear();
    },
    size() {
      return entries.size;
    },
  };
}

/* ----------------------------------------------- conversation Definition */

function eventTurn(event) {
  const data = event === undefined || event === null ? undefined : event.data;
  return data !== undefined && data !== null && typeof data.turn === 'number' ? data.turn : undefined;
}

function turnLocation(context) {
  const location = context.start?.location ?? context.matches.at(-1)?.location;
  return location !== undefined && (location.kind === 'turn' || location.kind === 'step') ? location.turn : undefined;
}

/**
 * Independent control anchor: exactly one node per closed Turn that carries
 * real process evidence and no native fold. It never emits for an open Turn,
 * and never for a single-step pure-text answer (no evidence => no control, so
 * the native "empty fold" cannot appear).
 */
export const turnFoldDefinition = {
  kind: TURN_FOLD_KIND,
  target: 'chat',
  match(event) {
    // Low-frequency, deterministic boundaries only: no per-token subscription.
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' };
    if (event.type === 'turn/end') {
      const turn = eventTurn(event);
      return turn === undefined ? null : { id: String(turn), role: 'update' };
    }
    return null;
  },
  start(_context, match) {
    if (match.event.type !== 'turn/start') throw new Error('turn-fold start requires turn/start');
    return { turn: match.event.data.turn };
  },
  update(context) {
    return context.state;
  },
  publication() {
    return 'immediate';
  },
  buildViewNode(context) {
    const turn = turnLocation(context);
    if (turn === undefined || turn.status !== 'closed') return null;
    // No loaded turn.start means the window head truncated this Turn: no control.
    if (turn.start === undefined) return null;
    const data = turn.data.get('turn-process');
    if (data === undefined || data === null) return null;
    const authored = data.answerAnchorSeq === null
      ? true
      : processCounts(data).total > 0 || data.inlineReasoning === true;
    if (!authored) return null;
    const endReason = turn.end === undefined || turn.end === null ? undefined : turn.end.data.reason;
    const endKind = endReason !== undefined && endReason !== null && typeof endReason.kind === 'string'
      ? endReason.kind
      : undefined;
    const payload = endKind === undefined ? data : { ...data, endKind };
    const current = context.current === undefined ? undefined : context.current.get('chat');
    // Reuse the previous identity while nothing that positions the control moved.
    if (current !== undefined && current !== null
      && current.kind === TURN_FOLD_KIND
      && (current.data === payload
        || (current.data !== undefined && current.data !== null
          && current.data.turn === data.turn
          && current.data.controlAnchorSeq === data.controlAnchorSeq
          && current.data.answerAnchorSeq === data.answerAnchorSeq
          && current.data.endKind === endKind))
      && current.anchorSeq === data.controlAnchorSeq + TURN_FOLD_ANCHOR_OFFSET) return current;
    return {
      key: context.key,
      kind: TURN_FOLD_KIND,
      id: context.id,
      target: 'chat',
      anchorSeq: data.controlAnchorSeq + TURN_FOLD_ANCHOR_OFFSET,
      location: context.start?.location ?? context.matches.at(-1)?.location ?? { kind: 'unresolved' },
      visibility: 'visible',
      data: payload,
    };
  },
};