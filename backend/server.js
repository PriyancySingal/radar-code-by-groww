const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const { symbolState, ensureWatchlist, seedDefaultWatchlist, persist } = require("./store");
const { buildDigest, checkin } = require("./diffEngine");
const simulator = require("./simulator");
const { SYMBOLS } = require("./symbols");

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

function symbolPublicState(symbol) {
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
    evidence: st.attention.evidence,
    dormancyMinutes: Number(dormancyMinutes.toFixed(1)),
    weekHigh: Number(st.weekHigh.toFixed(2)),
    weekLow: Number(st.weekLow.toFixed(2)),
    volume: st.lastVolume,
    history: st.history.slice(-40),
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

  // ---- GET /api/watchlist/:userId ----
  let m;
  if ((m = pathname.match(/^\/api\/watchlist\/([^/]+)$/)) && req.method === "GET") {
    const userId = decodeURIComponent(m[1]);
    seedDefaultWatchlist(userId);
    const wl = ensureWatchlist(userId);
    const items = [...wl].map(symbolPublicState).filter(Boolean);
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
    return sendJSON(res, 200, {
      symbol,
      score: st.attention.score,
      band: st.attention.band,
      evidence: st.attention.evidence,
      components: st.attention.components,
    });
  }

  // ---- POST /api/simulate/shock  { symbol, direction, magnitude } ----
  if (pathname === "/api/simulate/shock" && req.method === "POST") {
    const body = await readBody(req);
    const symbol = (body.symbol || "").toUpperCase();
    if (!symbolState.has(symbol)) return sendJSON(res, 400, { error: "Unknown symbol" });
    simulator.triggerShock(symbol, {
      direction: body.direction === "down" ? -1 : 1,
      magnitude: typeof body.magnitude === "number" ? body.magnitude : 0.045,
      volumeMultiplier: typeof body.volumeMultiplier === "number" ? body.volumeMultiplier : 6,
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
