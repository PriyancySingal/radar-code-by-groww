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
| §12 Demo-safe replay | `backend/simulator.js` → `triggerShock()`, wired to the "Demo control" panel in the UI |

## What's stubbed for the 72-hour cut (say this out loud in the pitch)

- **Persistence** is a flat JSON file (`data/persist.json`), not Postgres —
  swap-in point is `store.js`; the data model (§13) already anticipates it.
- **Live push** uses Server-Sent Events, not WebSockets — one-way is all
  this needs, and it's zero-dependency. Trivial to upgrade if two-way
  push (e.g. per-symbol subscribe/unsubscribe) becomes worth the
  complexity.
- **Multi-device conflict handling (op-log/CRDT from §10)** is not yet
  wired up — today it's last-write-wins on a single in-memory watchlist.
  This is the most valuable thing to build next with remaining time.
- **Auth** is a single hardcoded `demo-user` — the API is already
  per-`userId`, so real auth is additive, not a rewrite.

## Project layout

```
backend/
  server.js          HTTP server: REST API + SSE stream + static hosting
  simulator.js        Market tick generator, sector/market factors, shocks
  stats.js             Welford's incremental rolling mean/variance
  attentionEngine.js   Combines signals into the 0-100 Attention Score + evidence
  diffEngine.js        "Since you last checked" digest
  store.js              In-memory state + JSON persistence
  symbols.js           Seed universe (15 symbols, 5 sectors)
frontend/
  index.html
  style.css            Dark radar/terminal aesthetic
  app.js                SSE client, radar geometry, explain panel, watchlist UI
data/
  persist.json         Auto-created on first run
```
