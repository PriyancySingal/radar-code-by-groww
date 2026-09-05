const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const {
  symbolState,
  ensureWatchlist,
  seedDefaults,
  ensurePortfolio,
  persist,
  ensureAlertRules,
  setAlertRules,
  ensureAlertFeed,
} = require("./store");
const { buildDigest, checkin } = require("./diffEngine");
const simulator = require("./simulator");
const { SYMBOLS } = require("./symbols");
const eventEngine = require("./eventEngine");
const timelineEngine = require("./timelineEngine");

const PORT = process.env.PORT || 3000;
const FRONTEND_DIR = path.join(__dirname, "..", "frontend");

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        resolve({});
      }
    });
  });
}

function activeEventPublic(st) {
  return st.activeEvent ? { type: st.activeEvent.type, text: st.activeEvent.text } : null;
}

function symbolPublicState(symbol, extra = {}) {
  const st = symbolState.get(symbol);
  if (!st) return null;
  const dormancyMinutes = (Date.now() - st.dormancySince) / 60000;
  return {
    symbol,
    name: st.meta.name,
    sector: st.meta.sector,
    price: Number(st.price.toFixed(2)),
    score: st.attention.score,
    band: st.attention.band,
    confidence: st.attention.confidence ?? null,
    evidence: st.attention.evidence,
    activeEvent: activeEventPublic(st),
    dormancyMinutes: Number(dormancyMinutes.toFixed(1)),
    weekHigh: Number(st.weekHigh.toFixed(2)),
    weekLow: Number(st.weekLow.toFixed(2)),
    volume: st.lastVolume,
    history: st.history.slice(-40),
    ...extra,
  };
}

const MIME = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};

function serveStatic(req, res, pathname) {
  let filePath = pathname === "/" ? "/index.html" : pathname;
  filePath = path.join(FRONTEND_DIR, filePath);
  if (!filePath.startsWith(FRONTEND_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      return res.end("Not found");
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  // ---- SSE live stream ----
  if (pathname === "/api/stream" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.write("\n");
    simulator.subscribers.add(res);
    req.on("close", () => simulator.subscribers.delete(res));
    return;
  }

  // ---- GET /api/symbols ----
  if (pathname === "/api/symbols" && req.method === "GET") {
    const all = SYMBOLS.map((s) => symbolPublicState(s.symbol));
    return sendJSON(res, 200, { symbols: all });
  }

  // ---- GET /api/events/types (for the demo shock control) ----
  if (pathname === "/api/events/types" && req.method === "GET") {
    return sendJSON(res, 200, { types: eventEngine.EVENT_TYPES });
  }

  // ---- GET /api/watchlist/:userId ----
  let m;
  if ((m = pathname.match(/^\/api\/watchlist\/([^/]+)$/)) && req.method === "GET") {
    const userId = decodeURIComponent(m[1]);
    seedDefaults(userId);
    const wl = ensureWatchlist(userId);
    const pf = ensurePortfolio(userId);
    const items = [...wl]
      .map((symbol) => symbolPublicState(symbol, { isPortfolio: pf.has(symbol) }))
      .filter(Boolean);
    return sendJSON(res, 200, { userId, items });
  }

  // ---- POST /api/watchlist/:userId  { symbol } ----
  if ((m = pathname.match(/^\/api\/watchlist\/([^/]+)$/)) && req.method === "POST") {
    const userId = decodeURIComponent(m[1]);
    const body = await readBody(req);
    const symbol = (body.symbol || "").toUpperCase();
    if (!symbolState.has(symbol)) return sendJSON(res, 400, { error: "Unknown symbol" });
    ensureWatchlist(userId).add(symbol);
    persist();
    return sendJSON(res, 200, { ok: true });
  }

  // ---- DELETE /api/watchlist/:userId/:symbol ----
  if ((m = pathname.match(/^\/api\/watchlist\/([^/]+)\/([^/]+)$/)) && req.method === "DELETE") {
    const userId = decodeURIComponent(m[1]);
    const symbol = decodeURIComponent(m[2]).toUpperCase();
    ensureWatchlist(userId).delete(symbol);
    persist();
    return sendJSON(res, 200, { ok: true });
  }

  // ---- GET /api/portfolio/:userId ----
  // Portfolio mode: a user's actual holdings, prioritized above the
  // general watchlist and market-wide anomalies everywhere RADAR ranks
  // symbols (digest ordering, list sorting).
  if ((m = pathname.match(/^\/api\/portfolio\/([^/]+)$/)) && req.method === "GET") {
    const userId = decodeURIComponent(m[1]);
    seedDefaults(userId);
    const pf = ensurePortfolio(userId);
    const items = [...pf].map((symbol) => symbolPublicState(symbol, { isPortfolio: true })).filter(Boolean);
    return sendJSON(res, 200, { userId, items });
  }

  // ---- POST /api/portfolio/:userId  { symbol } ----
  if ((m = pathname.match(/^\/api\/portfolio\/([^/]+)$/)) && req.method === "POST") {
    const userId = decodeURIComponent(m[1]);
    const body = await readBody(req);
    const symbol = (body.symbol || "").toUpperCase();
    if (!symbolState.has(symbol)) return sendJSON(res, 400, { error: "Unknown symbol" });
    ensurePortfolio(userId).add(symbol);
    // A holding you own should always be on the watchlist too.
    ensureWatchlist(userId).add(symbol);
    persist();
    return sendJSON(res, 200, { ok: true });
  }

  // ---- DELETE /api/portfolio/:userId/:symbol ----
  if ((m = pathname.match(/^\/api\/portfolio\/([^/]+)\/([^/]+)$/)) && req.method === "DELETE") {
    const userId = decodeURIComponent(m[1]);
    const symbol = decodeURIComponent(m[2]).toUpperCase();
    ensurePortfolio(userId).delete(symbol);
    persist();
    return sendJSON(res, 200, { ok: true });
  }

  // ---- GET /api/digest/:userId ----
  if ((m = pathname.match(/^\/api\/digest\/([^/]+)$/)) && req.method === "GET") {
    const userId = decodeURIComponent(m[1]);
    const changes = buildDigest(userId);
    return sendJSON(res, 200, { userId, changes, count: changes.length });
  }

  // ---- POST /api/checkin/:userId ----
  if ((m = pathname.match(/^\/api\/checkin\/([^/]+)$/)) && req.method === "POST") {
    const userId = decodeURIComponent(m[1]);
    checkin(userId);
    persist();
    return sendJSON(res, 200, { ok: true });
  }

  // ---- GET /api/explain/:symbol ----
  if ((m = pathname.match(/^\/api\/explain\/([^/]+)$/)) && req.method === "GET") {
    const symbol = decodeURIComponent(m[1]).toUpperCase();
    const st = symbolState.get(symbol);
    if (!st) return sendJSON(res, 404, { error: "Unknown symbol" });

    const context = eventEngine.buildPossibleContext({
      symbol,
      sector: st.meta.sector,
      st,
      stockReturnPct: st.lastRecentMovePct,
      sectorReturnPct: st.lastSectorReturnPct,
      divergenceType: st.lastDivergenceType,
    });

    // "userId" is optional here — the explain panel is shared UI, but
    // when a userId is passed we can flag whether this is a portfolio
    // holding so the frontend can badge it accordingly.
    const requestUserId = url.searchParams.get("userId");
    const isPortfolio = requestUserId ? ensurePortfolio(requestUserId).has(symbol) : false;

    return sendJSON(res, 200, {
      symbol,
      name: st.meta.name,
      sector: st.meta.sector,
      price: Number(st.price.toFixed(2)),

      score: st.attention.score,
      rawScore: st.attention.rawScore ?? st.attention.score,
      band: st.attention.band,
      confidence: st.attention.confidence ?? null,

      evidence: st.attention.evidence,
      components: st.attention.components,
      normalChecklist: st.attention.normalChecklist || [],

      context,
      activeEvent: activeEventPublic(st),
      isPortfolio,

      sectorReturnPct: st.lastSectorReturnPct,
      marketReturnPct: st.lastMarketReturnPct,
      divergenceType: st.lastDivergenceType,
      recentMovePct: st.lastRecentMovePct,

      timeline: timelineEngine.getTimeline(symbol).slice(-12),

      history: st.history.slice(-40),
      weekHigh: Number(st.weekHigh.toFixed(2)),
      weekLow: Number(st.weekLow.toFixed(2)),
      volume: st.lastVolume,
    });
  }

  // ---- GET /api/timeline/:symbol ----
  if ((m = pathname.match(/^\/api\/timeline\/([^/]+)$/)) && req.method === "GET") {
    const symbol = decodeURIComponent(m[1]).toUpperCase();
    if (!symbolState.has(symbol)) return sendJSON(res, 404, { error: "Unknown symbol" });
    return sendJSON(res, 200, { symbol, events: timelineEngine.getTimeline(symbol) });
  }

  // ---- GET /api/alerts/:userId  (rules + recent feed) ----
  if ((m = pathname.match(/^\/api\/alerts\/([^/]+)$/)) && req.method === "GET") {
    const userId = decodeURIComponent(m[1]);
    return sendJSON(res, 200, {
      userId,
      rules: ensureAlertRules(userId),
      alerts: ensureAlertFeed(userId),
    });
  }

  // ---- POST /api/alerts/:userId  { rules } — update alert rules ----
  if ((m = pathname.match(/^\/api\/alerts\/([^/]+)$/)) && req.method === "POST") {
    const userId = decodeURIComponent(m[1]);
    const body = await readBody(req);
    const rules = setAlertRules(userId, body || {});
    persist();
    return sendJSON(res, 200, { ok: true, rules });
  }

  // ---- POST /api/simulate/shock  { symbol, direction, magnitude, eventType } ----
  if (pathname === "/api/simulate/shock" && req.method === "POST") {
    const body = await readBody(req);
    const symbol = (body.symbol || "").toUpperCase();
    if (!symbolState.has(symbol)) return sendJSON(res, 400, { error: "Unknown symbol" });
    simulator.triggerShock(symbol, {
      direction: body.direction === "down" ? -1 : 1,
      magnitude: typeof body.magnitude === "number" ? body.magnitude : 0.045,
      volumeMultiplier: typeof body.volumeMultiplier === "number" ? body.volumeMultiplier : 6,
      eventType: typeof body.eventType === "string" ? body.eventType : null,
    });
    return sendJSON(res, 200, { ok: true, symbol });
  }

  // ---- static frontend ----
  if (req.method === "GET") {
    return serveStatic(req, res, pathname);
  }

  sendJSON(res, 404, { error: "Not found" });
});

simulator.start();
setInterval(persist, 10000);

server.listen(PORT, () => {
  console.log(`Radar backend listening on http://localhost:${PORT}`);
});
