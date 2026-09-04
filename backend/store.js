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

// userId -> Map<symbol, { price, score, band, timestamp }>
const lastSeen = new Map();

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
      attention: { score: 0, band: "NORMAL", evidence: [] },
      dormancySince: now,
      weekHigh: meta.basePrice * 1.08,
      weekLow: meta.basePrice * 0.88,
    });
  }
}

function ensureWatchlist(userId) {
  if (!watchlists.has(userId)) watchlists.set(userId, new Set());
  return watchlists.get(userId);
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

function persist() {
  const data = {
    watchlists: Object.fromEntries([...watchlists.entries()].map(([u, set]) => [u, [...set]])),
    lastSeen: Object.fromEntries(
      [...lastSeen.entries()].map(([u, map]) => [u, Object.fromEntries(map.entries())])
    ),
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
    for (const [u, obj] of Object.entries(data.lastSeen || {})) {
      lastSeen.set(u, new Map(Object.entries(obj)));
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
  lastSeen,
  ensureWatchlist,
  ensureLastSeen,
  seedDefaultWatchlist,
  persist,
  HISTORY_LIMIT,
};
