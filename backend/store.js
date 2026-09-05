const fs = require("fs");
const path = require("path");
const { RollingStats } = require("./stats");
const { SYMBOLS } = require("./symbols");

const PERSIST_PATH = path.join(__dirname, "..", "data", "persist.json");
const HISTORY_LIMIT = 180; // ~ a few minutes of ticks at demo speed, enough for a sparkline

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
    });
  }
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

function persist() {
  const data = {
    watchlists: Object.fromEntries([...watchlists.entries()].map(([u, set]) => [u, [...set]])),
    portfolios: Object.fromEntries([...portfolios.entries()].map(([u, set]) => [u, [...set]])),
    lastSeen: Object.fromEntries(
      [...lastSeen.entries()].map(([u, map]) => [u, Object.fromEntries(map.entries())])
    ),
    alertRules: Object.fromEntries(alertRules.entries()),
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

  // Smart alerts
  ensureAlertRules,
  setAlertRules,
  ensureAlertFeed,
  pushAlert,
  DEFAULT_ALERT_RULES,
};
