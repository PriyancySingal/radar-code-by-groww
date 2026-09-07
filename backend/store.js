const fs = require("fs");
const path = require("path");
const { RollingStats } = require("./stats");
const { SYMBOLS } = require("./symbols");
const syncEngine = require("./syncEngine");

const PERSIST_PATH = path.join(__dirname, "..", "data", "persist.json");
const HISTORY_LIMIT = 180; // ~ a few minutes of ticks at demo speed, enough for a sparkline

// ---- Feed freshness simulation (doc §10) ----
//
// Real market-data feeds occasionally lag behind the true tape — a slow
// venue, consolidated-feed latency, a dropped packet. We simulate that
// per-symbol so every value can be honestly tagged Fresh / Delayed /
// Stale instead of pretending every quote is always instantaneous.
// `isWarm()` (stats.js) answers a different question — "do we trust the
// statistics yet?" — this answers "how recent is this print?".
const FEED_LAG_CHANCE = 0.02; // per symbol, per tick
const FEED_LAG_TICKS_MIN = 5; // ~10s at the 2s tick rate
const FEED_LAG_TICKS_MAX = 14; // ~28s
const FRESH_MS = 5000;
const STALE_MS = 15000;

function freshnessStatus(ageMs) {
  if (ageMs < FRESH_MS) return "FRESH";
  if (ageMs < STALE_MS) return "DELAYED";
  return "STALE";
}

// symbolState: symbol -> { meta, price, prevClose, priceStats, volumeStats,
//                           lastVolume, history[], attention, dormancySince,
//                           weekHigh, weekLow }
const symbolState = new Map();

// userId -> Set<symbol>
const watchlists = new Map();

// userId -> Set<symbol> — a user's actual holdings, prioritized above
// the general watchlist everywhere RADAR ranks or surfaces symbols.
const portfolios = new Map();

// userId -> Map<symbol, { price, score, band, timestamp }>
const lastSeen = new Map();

// userId -> { highAttention, volumeMultiple, priceMovePct, sectorDivergencePct }
const alertRules = new Map();

// userId -> [{ id, symbol, name, band, score, reasons, timestamp }]
const alertFeed = new Map();

// userId -> Map<symbol, number> — a user's own "alert me at ₹X" price
// levels (doc §4's "optional user-defined reference level"). Kept
// per-user rather than folded into the shared Attention Score, since
// the score is the same for every user watching a symbol while a
// reference level is personal — it drives that user's own alerts,
// the same way highAttention/volumeMultiple/etc. already do.
const referenceLevels = new Map();

const DEFAULT_ALERT_RULES = {
  highAttention: true,
  volumeMultiple: 5,
  priceMovePct: 4,
  sectorDivergencePct: 3,
};

function initSymbols() {
  const now = Date.now();
  for (const meta of SYMBOLS) {
    symbolState.set(meta.symbol, {
      meta,
      price: meta.basePrice,
      prevClose: meta.basePrice,
      priceStats: new RollingStats(),
      volumeStats: new RollingStats(),
      priceLevelStats: new RollingStats(20), // tracks price LEVEL (not return) for the volatility-band signal
      lastVolume: 0,
      history: [],
      attention: { score: 0, band: "NORMAL", evidence: [], confidence: 0 },
      dormancySince: now,
      weekHigh: meta.basePrice * 1.08,
      weekLow: meta.basePrice * 0.88,

      // Context / explainability additions
      activeEvent: null,
      lastSectorReturnPct: 0,
      lastMarketReturnPct: 0,
      lastDivergenceType: "NONE",
      lastRecentMovePct: 0,

      // Feed freshness simulation state (see advanceFeed/feedView below)
      feed: {
        lagTicksRemaining: 0,
        lastFreshAt: now,
        frozen: null,
      },
    });
  }
}

// Advances (or starts/ends) a symbol's simulated feed-delay window.
// `capturePrint()` is only invoked lazily when a new delay window
// begins, to snapshot "the last confirmed print" the frozen display
// will hold onto until the feed catches back up.
function advanceFeed(symbol, capturePrint, now = Date.now()) {
  const st = symbolState.get(symbol);
  if (!st) return;
  const feed = st.feed;

  if (feed.lagTicksRemaining > 0) {
    feed.lagTicksRemaining -= 1; // still delayed — keep serving `feed.frozen`
  } else if (Math.random() < FEED_LAG_CHANCE) {
    feed.frozen = capturePrint(); // last confirmed print before the lag started
    feed.lagTicksRemaining =
      FEED_LAG_TICKS_MIN + Math.floor(Math.random() * (FEED_LAG_TICKS_MAX - FEED_LAG_TICKS_MIN + 1));
    feed.lastFreshAt = now;
  } else {
    feed.frozen = null;
    feed.lastFreshAt = now; // continuously fresh
  }
}

// Read-only view of a symbol's current freshness. Safe to call at any
// time (not just on a tick boundary) since age is computed from the
// wall clock — used by both the SSE broadcast and plain REST reads.
function feedView(symbol, now = Date.now()) {
  const st = symbolState.get(symbol);
  if (!st) return { status: "FRESH", ageSeconds: 0, frozen: null };
  const ageMs = Math.max(0, now - st.feed.lastFreshAt);
  return {
    status: freshnessStatus(ageMs),
    ageSeconds: Math.round(ageMs / 1000),
    frozen: st.feed.lagTicksRemaining > 0 ? st.feed.frozen : null,
  };
}

function ensureReferenceLevels(userId) {
  if (!referenceLevels.has(userId)) referenceLevels.set(userId, new Map());
  return referenceLevels.get(userId);
}

function setReferenceLevel(userId, symbol, level) {
  const map = ensureReferenceLevels(userId);
  if (level === null || level === undefined || !Number.isFinite(level) || level <= 0) {
    map.delete(symbol);
  } else {
    map.set(symbol, level);
  }
  return Object.fromEntries(map);
}

function ensureAlertRules(userId) {
  if (!alertRules.has(userId)) alertRules.set(userId, { ...DEFAULT_ALERT_RULES });
  return alertRules.get(userId);
}

function setAlertRules(userId, partialRules) {
  const current = ensureAlertRules(userId);
  const next = { ...current, ...partialRules };
  alertRules.set(userId, next);
  return next;
}

function ensureAlertFeed(userId) {
  if (!alertFeed.has(userId)) alertFeed.set(userId, []);
  return alertFeed.get(userId);
}

function pushAlert(userId, alert) {
  const feed = ensureAlertFeed(userId);
  feed.unshift(alert);
  if (feed.length > 30) feed.length = 30;
  return alert;
}

function ensureWatchlist(userId) {
  if (!watchlists.has(userId)) watchlists.set(userId, new Set());
  return watchlists.get(userId);
}

function ensurePortfolio(userId) {
  if (!portfolios.has(userId)) portfolios.set(userId, new Set());
  return portfolios.get(userId);
}

function seedDefaultPortfolio(userId) {
  const pf = ensurePortfolio(userId);
  if (pf.size === 0) {
    ["RELIANCE", "HDFCBANK"].forEach((s) => pf.add(s));
  }
  // A portfolio holding should always be visible in the watchlist too —
  // you can't sensibly monitor a stock you own without also watching it.
  const wl = ensureWatchlist(userId);
  for (const s of pf) wl.add(s);
}

function ensureLastSeen(userId) {
  if (!lastSeen.has(userId)) lastSeen.set(userId, new Map());
  return lastSeen.get(userId);
}

function seedDefaultWatchlist(userId) {
  const wl = ensureWatchlist(userId);
  if (wl.size === 0) {
    ["TCS", "HDFCBANK", "RELIANCE", "MARUTI", "ITC", "SUNPHARMA"].forEach((s) => wl.add(s));
  }
}

// Seeds both defaults in a fixed order regardless of which endpoint is
// hit first. Calling seedDefaultWatchlist/seedDefaultPortfolio directly
// and independently from two different routes previously caused a bug:
// if /api/portfolio was requested before /api/watchlist ever was, its
// two symbols would already make the watchlist non-empty, so the
// watchlist's own default-seed check (`wl.size === 0`) would then skip
// silently — leaving 4 default watchlist symbols missing.
function seedDefaults(userId) {
  seedDefaultWatchlist(userId);
  seedDefaultPortfolio(userId);
}

// ---- CRDT-backed mutation helpers ----
//
// Every watchlist/portfolio mutation — whether it comes from the normal
// UI ("primary" device) or from the conflict-simulator's queued "device
// B" — goes through syncEngine.applyOp so there is exactly ONE rule for
// what happens when two edits disagree. See syncEngine.js for the model.

function applyWatchlistOp(userId, op) {
  const set = ensureWatchlist(userId);
  return syncEngine.applyOp("watchlist", userId, set, op);
}

function applyPortfolioOp(userId, op) {
  const set = ensurePortfolio(userId);
  const result = syncEngine.applyOp("portfolio", userId, set, op);
  // Product rule preserved from before: a held symbol is always also
  // watched. Only add — never auto-remove from the watchlist, since a
  // user may still want to keep watching something they sold.
  if (result.type === "add" && result.present) {
    applyWatchlistOp(userId, { type: "add", symbol: op.symbol, ts: op.ts, device: op.device });
  }
  return result;
}

// Resets the market SIMULATION back to a clean starting point — prices,
// attention scores, dormancy, feed freshness — so a demo can be re-run
// reliably without restarting the process (doc §12). User configuration
// (watchlist, portfolio, alert rules, multi-device sync history) is
// deliberately left untouched; a scenario reset shouldn't undo a
// judge's own setup.
function resetMarketState() {
  initSymbols();
  lastSeen.clear();
  alertFeed.clear();
  persist();
}

function persist() {
  const data = {
    watchlists: Object.fromEntries([...watchlists.entries()].map(([u, set]) => [u, [...set]])),
    portfolios: Object.fromEntries([...portfolios.entries()].map(([u, set]) => [u, [...set]])),
    lastSeen: Object.fromEntries(
      [...lastSeen.entries()].map(([u, map]) => [u, Object.fromEntries(map.entries())])
    ),
    alertRules: Object.fromEntries(alertRules.entries()),
    referenceLevels: Object.fromEntries(
      [...referenceLevels.entries()].map(([u, map]) => [u, Object.fromEntries(map.entries())])
    ),
    // Raw CRDT records (add/remove timestamps per symbol per user) so a
    // server restart doesn't lose conflict-resolution history — without
    // this, a delayed op replayed after restart could wrongly "win"
    // against an edit that actually happened after it.
    watchlistCRDT: syncEngine.allSnapshots("watchlist"),
    portfolioCRDT: syncEngine.allSnapshots("portfolio"),
  };
  fs.writeFile(PERSIST_PATH, JSON.stringify(data, null, 2), () => {});
}

function load() {
  try {
    const raw = fs.readFileSync(PERSIST_PATH, "utf8");
    const data = JSON.parse(raw);
    for (const [u, arr] of Object.entries(data.watchlists || {})) {
      watchlists.set(u, new Set(arr));
    }
    for (const [u, arr] of Object.entries(data.portfolios || {})) {
      portfolios.set(u, new Set(arr));
    }
    for (const [u, obj] of Object.entries(data.lastSeen || {})) {
      lastSeen.set(u, new Map(Object.entries(obj)));
    }
    for (const [u, rules] of Object.entries(data.alertRules || {})) {
      alertRules.set(u, { ...DEFAULT_ALERT_RULES, ...rules });
    }
    for (const [u, obj] of Object.entries(data.referenceLevels || {})) {
      referenceLevels.set(u, new Map(Object.entries(obj).map(([sym, lvl]) => [sym, Number(lvl)])));
    }
    for (const [u, records] of Object.entries(data.watchlistCRDT || {})) {
      syncEngine.loadSnapshot("watchlist", u, records);
    }
    for (const [u, records] of Object.entries(data.portfolioCRDT || {})) {
      syncEngine.loadSnapshot("portfolio", u, records);
    }
  } catch (e) {
    // no persisted state yet — fine, fresh start
  }
}

initSymbols();
load();

module.exports = {
  symbolState,
  watchlists,
  portfolios,
  lastSeen,
  ensureWatchlist,
  ensurePortfolio,
  ensureLastSeen,
  seedDefaultWatchlist,
  seedDefaultPortfolio,
  seedDefaults,
  persist,
  HISTORY_LIMIT,

  // CRDT-backed sync
  applyWatchlistOp,
  applyPortfolioOp,

  // Smart alerts
  ensureAlertRules,
  setAlertRules,
  ensureAlertFeed,
  pushAlert,
  DEFAULT_ALERT_RULES,

  // User-defined reference levels ("alert me at ₹X")
  ensureReferenceLevels,
  setReferenceLevel,

  // Feed freshness simulation
  advanceFeed,
  feedView,
  freshnessStatus,

  // Demo-safe scenario reset
  resetMarketState,
};
