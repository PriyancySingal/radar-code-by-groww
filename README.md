# Radar — Code, by Groww

A working MVP of the proposal: a market watchlist that scores every stock
against its **own** normal behaviour, remembers what you've already seen,
and shows you only what's genuinely out of character.

Zero external dependencies — pure Node.js built-ins on the backend, vanilla
JS/CSS/SVG on the frontend. Nothing to `npm install`, nothing to build.
That's deliberate: fewer moving parts that can break mid-demo, and every
line of code is doing product work, not framework boilerplate.

## Run it

```bash
cd backend
node server.js
```

Open **http://localhost:3000**. That's it — the same server hosts the API
and the frontend.

The market is a live simulator (ticks every 2s), so the product works
identically at 3am or during a live judging session — see "Demo control"
in Section 12 of the proposal.

## What's implemented

| Proposal section | Code |
|---|---|
| §4 Attention Engine (Welford's, price/volume z-score, divergence, dormancy, thresholds) | `backend/stats.js`, `backend/attentionEngine.js` |
| §6.1 "Since You Last Checked" diff engine | `backend/diffEngine.js` |
| §6.2 Radar view (distance = abnormality, size = score, sweep) | `frontend/app.js` → `renderRadar()`, `frontend/style.css` → `#sweepGroup` |
| §6.3 Explainability + calm state | `frontend/app.js` → `showExplain()`, `loadDigest()` |
| §7 Sector/market divergence | `backend/simulator.js` (per-tick sector & market factor), scored in `attentionEngine.js` |
| §9 Stateful architecture (market state, snapshots, last-seen) | `backend/store.js` |
| §11 Scaling (incremental stats, push only what's in view) | `stats.js` (O(1) Welford), SSE stream pushes ticks, not per-user polling |
| §12 Demo-safe replay | `backend/simulator.js` → `triggerShock()`, wired to the "Demo control" panel in the UI, plus a scripted "▶ Play guided demo" sequence for hands-off judging |
| §10 Multi-device conflict handling | `backend/syncEngine.js` (add-wins CRDT), `POST /api/sync/:userId`, "Conflict simulator" panel in the UI |

## What's stubbed for the 72-hour cut (say this out loud in the pitch)

- **Persistence** is a flat JSON file (`data/persist.json`), not Postgres —
  swap-in point is `store.js`; the data model (§13) already anticipates it.
- **Live push** uses Server-Sent Events, not WebSockets — one-way is all
  this needs, and it's zero-dependency. Trivial to upgrade if two-way
  push (e.g. per-symbol subscribe/unsubscribe) becomes worth the
  complexity.
- **Auth** is a single hardcoded `demo-user` — the API is already
  per-`userId`, so real auth is additive, not a rewrite.

## Multi-device conflict handling (`backend/syncEngine.js`)

The brief asks explicitly how we handle state across devices and
stale/delayed/conflicting data. Our answer:

Every watchlist/portfolio membership is modeled as an **add-wins OR-Set
element**, not a boolean. For each `(user, symbol)` we keep the newest
ADD timestamp and the newest REMOVE timestamp we've seen, each tagged
with the device that made it. Resolved membership = an add exists and
it is not older than the newest remove (add wins on an exact tie).

This gives us, for free:
- **Commutativity** — it doesn't matter what order two devices' edits
  arrive in, the final state converges the same way.
- **Idempotency** — replaying the same op twice (e.g. a retried
  request after a flaky connection) changes nothing.
- **No central lock or real-time coordination** between devices — each
  op only needs its own timestamp and device id.
- **Visible conflicts instead of silent ones** — every applied op
  reports whether it actually `tookEffect`. If a device removes a
  symbol and a newer add from elsewhere already overrides that, the op
  is applied (nothing is dropped or errors out) but the API tells the
  caller their intent was superseded, so the UI can say so instead of
  lying about what happened.

`POST /api/sync/:userId` takes a batch of `{kind, type, symbol, ts}`
ops from a device (used for a device that was offline/delayed and is
now flushing a queue) and merges them via the exact same
`applyOp` used by the normal `POST`/`DELETE` watchlist and portfolio
endpoints — there's one merge rule, not a "normal path" and a
"conflict path." The **Conflict simulator** panel in the UI drives
this directly: put "Device B" offline, queue an edit, make a
conflicting live edit as "Device A," then sync — you'll see the
resolution and why it went the way it did.

**Trade-off made on purpose:** this is last-write-wins per element with
add-wins tie-break, not a full per-field CRDT (we don't merge, say,
partial edits to alert-rule numbers this way — those stay simple
overwrite-on-save, since two devices editing the same numeric
threshold within the same second isn't a case worth the complexity).
Element-level add/remove is where real multi-device conflicts on a
watchlist actually happen, so that's where we spent the design budget.

## Other open questions from the brief, answered directly

- **What counts as a meaningful change?** `diffEngine.js` — not "any
  price move," but a materially better/worse Attention Score, a band
  change, or (as a floor, in case the statistical model hasn't warmed
  up yet) a move past a fixed % threshold. See the comment block at
  the top of that file for the reasoning.
- **Stale/delayed data:** the CRDT above handles stale *edits*. Stale
  *market data* is handled separately — `stats.js`'s `isWarm()` refuses
  to call anything anomalous until it has enough samples, rather than
  overreacting to noise from a cold start.
- **Scaling:** O(1) incremental stats per symbol (Welford's, not
  recompute-from-history), and the stream pushes ticks once and lets
  each client filter to its own watchlist rather than the server doing
  per-user computation on every tick.
- **Where we kept it simple on purpose:** no real NSE/BSE feed. The
  brief asks what counts as meaningful change and how the system
  behaves under stale/conflicting data — a live market feed doesn't
  change either answer, and it adds a real live-demo failure mode
  (auth, rate limits, market hours) for a hackathon room. The
  simulator is engineered to produce realistic anomaly patterns
  (per-symbol drift, sector/market factors, dormancy, shocks) so the
  *detection and product logic* being judged is exercised exactly the
  same way live data would exercise it.

## Project layout

```
backend/
  server.js          HTTP server: REST API + SSE stream + static hosting
  simulator.js        Market tick generator, sector/market factors, shocks
  stats.js             Welford's incremental rolling mean/variance
  attentionEngine.js   Combines signals into the 0-100 Attention Score + evidence
  diffEngine.js        "Since you last checked" digest
  syncEngine.js         Add-wins CRDT for multi-device watchlist/portfolio conflicts
  store.js              In-memory state + JSON persistence
  symbols.js           Seed universe (15 symbols, 5 sectors)
frontend/
  index.html
  style.css            Dark radar/terminal aesthetic
  app.js                SSE client, radar geometry, explain panel, watchlist UI
data/
  persist.json         Auto-created on first run
```
