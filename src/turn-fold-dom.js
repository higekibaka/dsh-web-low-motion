/**
 * Turn-fold Tool-call DOM bridge.
 *
 * This module owns exactly one narrow responsibility: for a finished Turn the
 * plugin's controller has decided to fold, mark the root element of the shipped
 * tool-call Chat node renderer searchably hidden (hidden="until-found"), and
 * remove that mark again. It never replaces or re-renders the shipped
 * ToolCallTree, never writes the Chat node seat's own hidden attribute (the
 * shipped useSearchableHidden owns it), never moves or re-parents React-managed
 * DOM, and never rewrites renderSlot.
 *
 * Verified host DOM path for one folded row (DSH 0.1.5-rc.1):
 *
 *   [data-chat-flow]                              Conversation column
 *     > [data-chat-flow-key="<key>"]              Chat node seat
 *       > [data-slot="conversation.chat.node"]    renderer outlet anchor
 *         > [data-chat-call-id="<callId>"][data-chat-anchor-key="call:<callId>"]
 *
 * Only direct children on every hop are accepted. Any extra wrapper, a missing
 * attribute, a mismatched Turn/key/kind, or a nested sub-call root fails open:
 * the row is left exactly as the shipped renderer produced it. A root another
 * owner already hides or marks is never taken over.
 *
 * Watch and mark lifecycles are deliberately separate. While a key is in the
 * controller's node list and the controller is collapsed, the known seat and
 * slot anchor are observed even when the root is currently absent or still
 * unknown; a later root insertion is therefore folded. A root removal drops
 * only the mark, never the watch, so a re-inserted root is folded on the next
 * mutation. Every controller owns a unique marker token; cleanup only removes
 * the token's own attributes and never a value another owner replaced.
 *
 * @module dsh-web-low-motion/turn-fold-dom
 */

/** Attribute this bridge sets on a root it owns; CSS matches it by presence. */
const MARKER = 'data-dsh-turn-fold-tool-hidden';
const FLOW = 'data-chat-flow';
const FLOW_KEY = 'data-chat-flow-key';
const FLOW_KIND = 'data-chat-flow-kind';
const FLOW_TURN = 'data-chat-turn';
const SLOT = 'data-slot';
const SLOT_NODE = 'conversation.chat.node';
const CALL_ID = 'data-chat-call-id';
const ANCHOR_KEY = 'data-chat-anchor-key';
const HIDDEN_UNTIL_FOUND = 'until-found';
const FLOW_KIND_TOOL_CALL = 'tool-call';

/** Unique marker value per controller instance. */
let nextToken = 0;

/** @type {WeakMap<Element, object>} column -> shared record */
const columns = new WeakMap();

/** @param {unknown} node @returns {Element | null} */
function elementOf(node) {
  return node !== null && typeof node === 'object' && node.nodeType === 1
    ? /** @type {Element} */ (node)
    : null;
}

/** @param {Element} element @returns {string | null} */
function readFlowKey(element) {
  const value = element.getAttribute(FLOW_KEY);
  return value === null || value === '' ? null : value;
}

/**
 * First direct element child matching the predicate (never a descendant).
 * @param {Element} parent
 * @param {(child: Element) => boolean} predicate
 * @returns {Element | null}
 */
function directChild(parent, predicate) {
  const children = parent.children;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child.nodeType === 1 && predicate(child)) return child;
  }
  return null;
}

/** @param {Element} seat @returns {Element | null} the slot outlet anchor */
function slotAnchorOf(seat) {
  return directChild(seat, child => child.getAttribute(SLOT) === SLOT_NODE);
}

/**
 * @param {Element} anchor
 * @param {string} callId
 * @returns {Element | null} the shipped renderer root, or null (fail open)
 */
function rootOf(anchor, callId) {
  const expected = 'call:' + callId;
  return directChild(anchor, child => child.getAttribute(CALL_ID) === callId
    && child.getAttribute(ANCHOR_KEY) === expected);
}

/** @param {Element} root @returns {boolean} */
function containsActiveElement(root) {
  const doc = root.ownerDocument;
  const active = doc === null ? null : doc.activeElement;
  return active !== null && active !== undefined && root.contains(active);
}

/**
 * Build the shared column record. The single initial seat scan happens here.
 * @param {Element} column
 * @returns {object}
 */
function createRecord(column) {
  const record = {
    column,
    seats: new Map(),
    controllers: new Set(),
    targets: new Map(),
    targetControllers: new Map(),
    keyControllers: new Map(),
    observer: null,
    needsRebuild: false,
    flushing: false,
  };
  const children = column.children;
  for (let index = 0; index < children.length; index += 1) {
    const child = elementOf(children[index]);
    if (child === null) continue;
    const key = readFlowKey(child);
    if (key !== null) record.seats.set(key, child);
  }
  record.observer = new MutationObserver(mutations => { handleMutations(record, mutations); });
  record.observer.observe(column, { childList: true });
  return record;
}

/** @param {Element} column @returns {object} */
function acquireRecord(column) {
  let record = columns.get(column);
  if (record === undefined) {
    record = createRecord(column);
    columns.set(column, record);
  }
  return record;
}

/** @param {object} record */
function releaseRecord(record) {
  if (record.controllers.size > 0) return;
  record.observer.disconnect();
  record.targets.clear();
  record.targetControllers.clear();
  record.keyControllers.clear();
  columns.delete(record.column);
}

/**
 * @param {object} record
 * @param {string} key
 * @param {object} controller
 */
function addKeyController(record, key, controller) {
  let set = record.keyControllers.get(key);
  if (set === undefined) {
    set = new Set();
    record.keyControllers.set(key, set);
  }
  set.add(controller);
}

/**
 * @param {object} record
 * @param {string} key
 * @param {object} controller
 */
function removeKeyController(record, key, controller) {
  const set = record.keyControllers.get(key);
  if (set === undefined) return;
  set.delete(controller);
  if (set.size === 0) record.keyControllers.delete(key);
}

/**
 * @param {object} record
 * @param {object} controller
 * @param {Element} target
 */
function retainTarget(record, controller, target) {
  const count = record.targets.get(target);
  if (count === undefined) {
    record.targets.set(target, 1);
    record.observer.observe(target, { childList: true });
  } else {
    record.targets.set(target, count + 1);
  }
  let set = record.targetControllers.get(target);
  if (set === undefined) {
    set = new Set();
    record.targetControllers.set(target, set);
  }
  set.add(controller);
}

/**
 * Drop one watch reference. The actual observer rebuild is deferred and batched
 * by flushTargets so N releases never cause N disconnect/re-observe cycles.
 * @param {object} record
 * @param {object} controller
 * @param {Element} target
 */
function releaseTarget(record, controller, target) {
  const count = record.targets.get(target);
  if (count === undefined) return;
  const set = record.targetControllers.get(target);
  if (set !== undefined) {
    set.delete(controller);
    if (set.size === 0) record.targetControllers.delete(target);
  }
  if (count <= 1) {
    record.targets.delete(target);
    record.needsRebuild = true;
    return;
  }
  record.targets.set(target, count - 1);
}

/**
 * Apply every deferred watch change once. MutationObserver exposes no
 * per-target unobserve, so the observation set is rebuilt from the retained
 * map; pending records are drained first so a rebuild can never lose a column
 * childList mutation and leave the seat index stale.
 * @param {object} record
 */
function flushTargets(record) {
  if (record.flushing) return;
  record.flushing = true;
  try {
    while (record.needsRebuild) {
      record.needsRebuild = false;
      const pending = record.observer.takeRecords();
      if (pending.length > 0) handleMutations(record, pending);
      record.observer.disconnect();
      record.observer.observe(record.column, { childList: true });
      for (const target of record.targets.keys()) {
        record.observer.observe(target, { childList: true });
      }
    }
  } finally {
    record.flushing = false;
  }
}

/**
 * Incrementally maintain the seat index, then reconcile only the controllers a
 * mutation can affect (by seat key or by observed target). Only direct children
 * are reported, so this never reacts to streaming text or attribute churn.
 * @param {object} record
 * @param {readonly MutationRecord[]} mutations
 */
function handleMutations(record, mutations) {
  const pending = new Set();
  const affectedKeys = new Set();
  for (const mutation of mutations) {
    if (mutation.target === record.column) {
      for (const node of mutation.removedNodes) {
        const element = elementOf(node);
        if (element === null) continue;
        const key = readFlowKey(element);
        if (key !== null) {
          if (record.seats.get(key) === element) record.seats.delete(key);
          affectedKeys.add(key);
        }
        const watchers = record.targetControllers.get(element);
        if (watchers !== undefined) for (const controller of watchers) pending.add(controller);
      }
      for (const node of mutation.addedNodes) {
        const element = elementOf(node);
        if (element === null) continue;
        const key = readFlowKey(element);
        if (key !== null) {
          record.seats.set(key, element);
          affectedKeys.add(key);
        }
      }
      continue;
    }
    const watchers = record.targetControllers.get(mutation.target);
    if (watchers !== undefined) for (const controller of watchers) pending.add(controller);
  }
  for (const key of affectedKeys) {
    const controllers = record.keyControllers.get(key);
    if (controllers !== undefined) for (const controller of controllers) pending.add(controller);
  }
  for (const controller of pending) controller.reconcile();
  flushTargets(record);
}

/** One Turn's controller inside one Conversation column. */
class ToolFoldController {
  /**
   * @param {Element} column
   * @param {number} turn
   * @param {() => void} reveal
   */
  constructor(column, turn, reveal) {
    nextToken += 1;
    this.token = 'dsh-turn-fold-tool-' + nextToken;
    this.column = column;
    this.turnText = String(turn);
    this.reveal = reveal;
    /** @type {Map<string, string>} key -> callId */
    this.nodes = new Map();
    /** @type {Map<string, { root: Element, onBeforeMatch: () => void }>} */
    this.marks = new Map();
    /** @type {Map<string, { seat: Element, anchor: Element | null }>} */
    this.watches = new Map();
    /** @type {Set<string>} keys routed to this controller while collapsed */
    this.registeredKeys = new Set();
    this.collapsed = false;
    this.disposed = false;
    this.reconciling = false;
    this.pendingReconcile = false;
    this.record = acquireRecord(column);
    this.record.controllers.add(this);
  }

  /**
   * @param {{ nodes?: ReadonlyArray<{ key?: unknown, callId?: unknown }>, collapsed: boolean }} input
   */
  update(input) {
    if (this.disposed) return;
    if (input === null || typeof input !== 'object') {
      throw new TypeError('turn-fold-dom: update({ nodes, collapsed }) requires an object');
    }
    if (typeof input.collapsed !== 'boolean') {
      throw new TypeError('turn-fold-dom: update requires a boolean collapsed');
    }
    const next = new Map();
    if (Array.isArray(input.nodes)) {
      for (const item of input.nodes) {
        if (item === null || typeof item !== 'object') continue;
        const key = item.key;
        const callId = item.callId;
        if (typeof key !== 'string' || key === '') continue;
        if (typeof callId !== 'string' || callId === '') continue;
        next.set(key, callId);
      }
    }
    this.nodes = next;
    this.collapsed = input.collapsed;
    this.syncKeyControllers();
    this.reconcile();
    flushTargets(this.record);
  }

  /** Idempotent teardown: drop this Turn's own marks/watch routing and release the shared record. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const key of [...this.marks.keys()]) this.unmark(key);
    this.releaseAllWatches();
    this.unregisterKeys();
    this.record.controllers.delete(this);
    flushTargets(this.record);
    releaseRecord(this.record);
  }

  /** Reentrancy-safe reconcile; a reentrant update is re-run after the current pass. */
  reconcile() {
    if (this.disposed) return;
    if (this.reconciling) {
      this.pendingReconcile = true;
      return;
    }
    this.reconciling = true;
    try {
      do {
        this.pendingReconcile = false;
        this.reconcileOnce();
      } while (this.pendingReconcile && !this.disposed);
    } finally {
      this.reconciling = false;
    }
  }

  /** Route key-level mutations to this controller only while it can hide rows. */
  syncKeyControllers() {
    const desired = this.collapsed ? new Set(this.nodes.keys()) : new Set();
    for (const key of desired) {
      if (this.registeredKeys.has(key)) continue;
      this.registeredKeys.add(key);
      addKeyController(this.record, key, this);
    }
    for (const key of [...this.registeredKeys]) {
      if (desired.has(key)) continue;
      this.registeredKeys.delete(key);
      removeKeyController(this.record, key, this);
    }
  }

  /** @param {string} key @returns {Element | undefined} */
  validSeat(key) {
    const seat = this.record.seats.get(key);
    if (seat === undefined) return undefined;
    if (seat.parentElement !== this.column) return undefined;
    if (readFlowKey(seat) !== key) return undefined;
    if (seat.getAttribute(FLOW_KIND) !== FLOW_KIND_TOOL_CALL) return undefined;
    if (seat.getAttribute(FLOW_TURN) !== this.turnText) return undefined;
    return seat;
  }

  /**
   * Keep watches in step with the node list: a known seat/slot anchor stays
   * observed even when its root is absent, so a later insertion is folded.
   */
  syncWatches() {
    const desired = new Map();
    if (this.collapsed) {
      for (const key of this.nodes.keys()) {
        const seat = this.validSeat(key);
        if (seat === undefined) continue;
        desired.set(key, { seat, anchor: slotAnchorOf(seat) });
      }
    }
    for (const [key, watch] of [...this.watches]) {
      const next = desired.get(key);
      const same = next !== undefined && next.seat === watch.seat && next.anchor === watch.anchor;
      if (same) continue;
      this.watches.delete(key);
      releaseTarget(this.record, this, watch.seat);
      if (watch.anchor !== null && watch.anchor !== watch.seat) releaseTarget(this.record, this, watch.anchor);
    }
    for (const [key, watch] of desired) {
      if (this.watches.has(key)) continue;
      retainTarget(this.record, this, watch.seat);
      if (watch.anchor !== null && watch.anchor !== watch.seat) retainTarget(this.record, this, watch.anchor);
      this.watches.set(key, watch);
    }
  }

  reconcileOnce() {
    /** @type {Map<string, { seat: Element, anchor: Element, root: Element }>} */
    const desired = new Map();
    if (this.collapsed && this.nodes.size > 0) {
      for (const [key, callId] of this.nodes) {
        const seat = this.validSeat(key);
        if (seat === undefined) continue;
        const anchor = slotAnchorOf(seat);
        if (anchor === null) continue;
        const root = rootOf(anchor, callId);
        if (root === null) continue;
        desired.set(key, { seat, anchor, root });
      }
      for (const entry of desired.values()) {
        if (containsActiveElement(entry.root)) {
          this.collapsed = false;
          this.callReveal();
          desired.clear();
          break;
        }
      }
    }
    this.syncWatches();
    for (const key of [...this.marks.keys()]) {
      const keep = desired.get(key);
      const tracked = this.marks.get(key);
      if (keep === undefined || tracked === undefined || keep.root !== tracked.root) this.unmark(key);
    }
    for (const [key, entry] of desired) this.mark(key, entry);
    // A focus conflict flips collapsed inside this pass; keep key routing in
    // step with the effective state so no stale key waits for a parent update.
    this.syncKeyControllers();
  }

  /**
   * @param {string} key
   * @param {{ root: Element, anchor: Element, seat: Element }} entry
   */
  mark(key, entry) {
    const { root } = entry;
    const tracked = this.marks.get(key);
    if (tracked !== undefined && tracked.root === root) {
      if (root.getAttribute(MARKER) !== this.token) {
        // Another owner replaced the marker: drop our bookkeeping, never theirs.
        this.dropMark(key);
        return;
      }
      if (!root.hasAttribute('hidden')) root.setAttribute('hidden', HIDDEN_UNTIL_FOUND);
      return;
    }
    if (tracked !== undefined) this.unmark(key);
    // Never take over a row another owner already hides or marks.
    if (root.hasAttribute(MARKER) || root.hasAttribute('hidden')) return;
    root.setAttribute(MARKER, this.token);
    root.setAttribute('hidden', HIDDEN_UNTIL_FOUND);
    const onBeforeMatch = () => { this.handleBeforeMatch(); };
    this.marks.set(key, { root, onBeforeMatch });
    root.addEventListener('beforematch', onBeforeMatch);
  }

  /** Forget a mark whose ownership was taken over, touching no attribute. @param {string} key */
  dropMark(key) {
    const tracked = this.marks.get(key);
    if (tracked === undefined) return;
    this.marks.delete(key);
    tracked.root.removeEventListener('beforematch', tracked.onBeforeMatch);
  }

  /** @param {string} key */
  unmark(key) {
    const tracked = this.marks.get(key);
    if (tracked === undefined) return;
    this.marks.delete(key);
    const { root, onBeforeMatch } = tracked;
    root.removeEventListener('beforematch', onBeforeMatch);
    if (root.getAttribute(MARKER) === this.token) {
      if (root.getAttribute('hidden') === HIDDEN_UNTIL_FOUND) root.removeAttribute('hidden');
      root.removeAttribute(MARKER);
    }
  }

  /** Browser find-in-page reached a folded row: reveal the Turn and let search see it. */
  handleBeforeMatch() {
    if (this.disposed) return;
    this.collapsed = false;
    this.callReveal();
    this.reconcile();
    if (!this.disposed) flushTargets(this.record);
  }

  callReveal() {
    try {
      this.reveal();
    } catch {
      // A controller error must never break find-in-page.
    }
  }

  releaseAllWatches() {
    for (const watch of this.watches.values()) {
      releaseTarget(this.record, this, watch.seat);
      if (watch.anchor !== null && watch.anchor !== watch.seat) releaseTarget(this.record, this, watch.anchor);
    }
    this.watches.clear();
  }

  unregisterKeys() {
    for (const key of this.registeredKeys) removeKeyController(this.record, key, this);
    this.registeredKeys.clear();
  }
}

/**
 * Create one Turn's Tool-call fold bridge inside the column owning anchor.
 *
 * @param {{ anchor: Element, turn: number, reveal: () => void }} options
 *   - anchor: the independent control bar's own DOM element; its
 *     closest('[data-chat-flow]') must resolve the Conversation column.
 *   - turn: non-negative integer identical to the seat's data-chat-turn.
 *   - reveal: called when a fold must be undone (find-in-page beforematch or a
 *     focus conflict); the DOM layer never owns the fold state.
 * @returns {{ update: (input: { nodes?: ReadonlyArray<{ key: string, callId: string }>, collapsed: boolean }) => void, dispose: () => void }}
 *   - update({ nodes, collapsed }): nodes is the Turn's proven-foldable process
 *     rows as { key, callId } (key = real data-chat-flow-key, callId =
 *     node.data.root.callId); collapsed hides or restores them. Invalid entries
 *     fail open and are ignored.
 *   - dispose(): idempotent; removes this Turn's own marks and listeners and
 *     releases the shared column index/observer when the last controller leaves.
 * @throws {TypeError} when the arguments are malformed or anchor is not in a column.
 */
export function createToolFoldDOM(options) {
  if (options === null || typeof options !== 'object') {
    throw new TypeError('turn-fold-dom: createToolFoldDOM requires { anchor, turn, reveal }');
  }
  const anchor = options.anchor;
  const turn = options.turn;
  const reveal = options.reveal;
  if (anchor === null || typeof anchor !== 'object' || typeof anchor.closest !== 'function') {
    throw new TypeError('turn-fold-dom: anchor must be an Element');
  }
  if (!Number.isInteger(turn) || turn < 0) {
    throw new TypeError('turn-fold-dom: turn must be a non-negative integer');
  }
  if (typeof reveal !== 'function') {
    throw new TypeError('turn-fold-dom: reveal must be a function');
  }
  const column = anchor.closest('[' + FLOW + ']');
  if (column === null || column === undefined) {
    throw new TypeError('turn-fold-dom: anchor is not inside a [' + FLOW + '] column');
  }
  const controller = new ToolFoldController(column, turn, reveal);
  return {
    update(input) { controller.update(input); },
    dispose() { controller.dispose(); },
  };
}
