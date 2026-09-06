// syncEngine.js
//
// Answers the brief's question head-on: "how do you handle stale,
// delayed or conflicting data" when the same watchlist/portfolio is
// edited from more than one device/session.
//
// Model: each (userId, symbol) membership is an add-wins OR-Set element.
// We don't store just "is it in the set" — we store the newest ADD
// timestamp and the newest REMOVE timestamp we've seen for that element,
// each tagged with the device that made it:
//
//   { addedAt: { ts, device } | null, removedAt: { ts, device } | null }
//
// Resolved membership = an add exists, and it is not older than the
// newest remove (add wins on an exact tie). This makes every op
// idempotent and commutative — it doesn't matter what order two
// devices' edits arrive in, or how late a delayed op shows up, the
// final state converges the same way. That's what "stale or delayed
// data" needs: correctness without a central lock or real-time
// coordination between devices.
//
// Every applied op reports back whether it actually "took effect" in
// the resolved state. When it didn't, that IS the conflict: a device
// tried to do something and a newer op from elsewhere already
// overrides it. We surface that explicitly instead of silently
// dropping it, because a hidden conflict is worse than a visible one.

const crdtStore = new Map(); // key ("watchlist"|"portfolio") -> userId -> symbol -> record

function bucketFor(kind) {
  if (!crdtStore.has(kind)) crdtStore.set(kind, new Map());
  return crdtStore.get(kind);
}

function ensureUserRecords(kind, userId) {
  const bucket = bucketFor(kind);
  if (!bucket.has(userId)) bucket.set(userId, new Map());
  return bucket.get(userId);
}

function resolvedPresent(record) {
  if (!record || !record.addedAt) return false;
  if (!record.removedAt) return true;
  return record.addedAt.ts >= record.removedAt.ts; // add wins on tie
}

/**
 * Apply a single op to the CRDT and keep `materializedSet` (the plain
 * Set<string> the rest of the app already reads/iterates) in sync.
 *
 * op: { type: "add"|"remove", symbol, ts, device }
 * returns { present, tookEffect, changedMembership, previouslyPresent }
 */
function applyOp(kind, userId, materializedSet, op) {
  const { type, symbol, device } = op;
  const ts = Number.isFinite(op.ts) ? op.ts : Date.now();
  const records = ensureUserRecords(kind, userId);
  const cur = records.get(symbol) || { addedAt: null, removedAt: null };

  const previouslyPresent = resolvedPresent(cur);

  if (type === "add") {
    if (!cur.addedAt || ts > cur.addedAt.ts) cur.addedAt = { ts, device };
  } else {
    if (!cur.removedAt || ts > cur.removedAt.ts) cur.removedAt = { ts, device };
  }
  records.set(symbol, cur);

  const present = resolvedPresent(cur);
  const tookEffect = type === "add" ? present : !present;

  if (present && !materializedSet.has(symbol)) materializedSet.add(symbol);
  if (!present && materializedSet.has(symbol)) materializedSet.delete(symbol);

  return {
    symbol,
    type,
    present,
    tookEffect,
    changedMembership: present !== previouslyPresent,
    record: cur,
  };
}

function snapshot(kind, userId) {
  const records = ensureUserRecords(kind, userId);
  return Object.fromEntries(records.entries());
}

function loadSnapshot(kind, userId, obj) {
  const records = ensureUserRecords(kind, userId);
  for (const [symbol, rec] of Object.entries(obj || {})) {
    records.set(symbol, rec);
  }
}

function allSnapshots(kind) {
  const bucket = bucketFor(kind);
  return Object.fromEntries(
    [...bucket.entries()].map(([userId, records]) => [userId, Object.fromEntries(records.entries())])
  );
}

module.exports = {
  applyOp,
  snapshot,
  loadSnapshot,
  allSnapshots,
  resolvedPresent,
};
