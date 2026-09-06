const { symbolState, HISTORY_LIMIT, watchlists } = require("./store");
const { computeAttentionScore, bandFor } = require("./attentionEngine");
const { SYMBOLS } = require("./symbols");
const eventEngine = require("./eventEngine");
const timelineEngine = require("./timelineEngine");
const alertsEngine = require("./alertsEngine");
const backtestEngine = require("./backtestEngine");

const TICK_MS = 2000; // accelerated vs real markets — a demo can't wait for real volatility
const subscribers = new Set(); // SSE response objects

const SECTORS = [...new Set(SYMBOLS.map((s) => s.sector))];

// Pending manual shocks requested via the API (demo control).
// A shock decays over several ticks instead of firing for a single 2s tick,
// so it's actually visible (and clickable) during a live demo.
const SHOCK_DECAY = [1, 0.8, 0.55, 0.35, 0.18, 0.08];
const pendingShocks = new Map(); // symbol -> { step, magnitude, volumeMultiplier }

// How much of the previously *displayed* attention score survives each
// tick once the raw/instantaneous score drops. This is what makes a
// signal cool down gradually (HIGH -> IMPORTANT -> WATCH -> NORMAL)
// instead of snapping back to 0 the instant the anomaly passes.
const SCORE_DECAY_FACTOR = 0.82;

// How many ticks back we look to compute "recent move %", used for
// smart alerts and for the possible-context explanation. At the demo's
// 2s tick rate, 15 ticks ~= 30s of simulated market time.
const MOVE_WINDOW_TICKS = 15;

// Evidence type -> short label used to seed the signal timeline the
// first time a symbol becomes worth watching.
const EVIDENCE_LABEL = {
  PRICE_ANOMALY: "Price breakout",
  VOLUME_ANOMALY: "Volume anomaly",
  SECTOR_DIVERGENCE: "Sector divergence",
  MARKET_DIVERGENCE: "Market-wide move",
  DORMANCY_BREAK: "Dormancy break",
  THRESHOLD: "Threshold breach",
};

function gaussianRandom() {
  // Box-Muller — good enough for a demo-realistic random walk
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function triggerShock(symbol, { direction = 1, magnitude = 0.045, volumeMultiplier = 6, eventType = null } = {}) {
  pendingShocks.set(symbol, { step: 0, magnitude: magnitude * direction, volumeMultiplier });

  // A manually triggered shock always comes with an explanation — that's
  // the whole point of the demo control ("show the system detect AND
  // explain it in real time").
  const st = symbolState.get(symbol);
  if (st) eventEngine.attachEvent(st, eventType);
}

function broadcast(payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of subscribers) {
    res.write(data);
  }
}

function timelineTextFor(band, evidence) {
  if (band === "HIGH_ATTENTION") return "HIGH ATTENTION";
  if (band === "IMPORTANT") return "IMPORTANT — attention rising";
  if (band === "WORTH_WATCHING") {
    const top = evidence && evidence[0];
    return top ? EVIDENCE_LABEL[top.type] || "Worth watching" : "Worth watching";
  }
  return "Signal cooling";
}

function tick() {
  const now = Date.now();

  // 1) Generate a per-symbol return this tick (market factor + sector factor + idiosyncratic)
  const marketFactor = gaussianRandom() * 0.0009;
  const sectorFactor = {};
  for (const sec of SECTORS) sectorFactor[sec] = gaussianRandom() * 0.0012;

  const returns = {};
  for (const meta of SYMBOLS) {
    const st = symbolState.get(meta.symbol);
    let idio = gaussianRandom() * 0.0016;

    let volumeMultiplier = 1 + Math.abs(gaussianRandom()) * 0.35;

    const shock = pendingShocks.get(meta.symbol);
    if (shock) {
      const decay = SHOCK_DECAY[shock.step] ?? 0;
      idio += shock.magnitude * decay;
      volumeMultiplier *= 1 + (shock.volumeMultiplier - 1) * decay;
      shock.step += 1;
      if (shock.step >= SHOCK_DECAY.length) {
        pendingShocks.delete(meta.symbol);
      }
    }

    const ret = marketFactor + sectorFactor[meta.sector] + idio;
    returns[meta.symbol] = { ret, volumeMultiplier };

    const newPrice = Math.max(1, st.price * (1 + ret));
    st.price = newPrice;
    if (newPrice > st.weekHigh) st.weekHigh = newPrice;
    if (newPrice < st.weekLow) st.weekLow = newPrice;
  }

  // 2) Aggregate sector / market returns for divergence scoring
  const sectorReturnAvg = {};
  for (const sec of SECTORS) {
    const syms = SYMBOLS.filter((s) => s.sector === sec).map((s) => s.symbol);
    sectorReturnAvg[sec] = syms.reduce((a, s) => a + returns[s].ret, 0) / syms.length;
  }
  const marketReturnAvg = SYMBOLS.reduce((a, s) => a + returns[s.symbol].ret, 0) / SYMBOLS.length;

  // 3) Update rolling stats, volume, dormancy, and compute the Attention Score
  const updates = [];
  const updatesBySymbol = new Map();

  for (const meta of SYMBOLS) {
    const st = symbolState.get(meta.symbol);
    const { ret, volumeMultiplier } = returns[meta.symbol];

    eventEngine.clearExpiredEvent(st, now);

    st.priceStats.update(ret);
    const priceZ = st.priceStats.zScore(ret);

    const baseVolume = 100000 * (meta.basePrice > 3000 ? 0.6 : 1.4); // cheaper stocks trade more shares
    const volume = Math.round(baseVolume * volumeMultiplier);
    st.volumeStats.update(volume);
    const volumeZ = st.volumeStats.zScore(volume);
    const avgVolume = st.volumeStats.mean || volume;
    const volumeRatio = avgVolume > 0 ? volume / avgVolume : 1;
    st.lastVolume = volume;

    const distanceToHighPct = (st.weekHigh - st.price) / st.weekHigh;
    const distanceToLowPct = (st.price - st.weekLow) / st.weekLow;

    const dormancyMinutes = (now - st.dormancySince) / 60000;
    const sectorReturn = sectorReturnAvg[meta.sector];
    const marketReturn = marketReturnAvg;

    const attention = computeAttentionScore({
      symbol: meta.symbol,
      priceReturn: ret,
      priceZ,
      volumeRatio,
      volumeZ,
      sectorReturn,
      marketReturn,
      dormancyMinutes,
      distanceToHighPct,
      distanceToLowPct, // distance ABOVE the 52-week low (>=0), mirrors distanceToHighPct's semantics
      priceWarm: st.priceStats.isWarm(),
      volumeWarm: st.volumeStats.isWarm(),
    });

    // ------------------------------------------------------------
    // SCORE DECAY
    //
    // The raw score reacts instantly. The *displayed* score is only
    // allowed to rise instantly — when it falls, it decays gradually
    // so a signal reads as a real monitoring system ("cooling down")
    // rather than a static classifier that flips on and off.
    // ------------------------------------------------------------
    const prevDisplayScore = st.attention?.score || 0;
    const prevBand = st.attention?.band || "NORMAL";

    let displayScore = attention.score;
    if (displayScore < prevDisplayScore) {
      displayScore = Math.max(displayScore, prevDisplayScore * SCORE_DECAY_FACTOR);
    }
    displayScore = Math.round(displayScore);
    const displayBand = bandFor(displayScore);

    st.attention = {
      ...attention,
      rawScore: attention.score,
      score: displayScore,
      band: displayBand,
    };

    if (displayBand !== "NORMAL") st.dormancySince = now;

    // ------------------------------------------------------------
    // SIGNAL TIMELINE — record every band transition
    // ------------------------------------------------------------
    if (displayBand !== prevBand) {
      timelineEngine.recordEvent(meta.symbol, displayBand, timelineTextFor(displayBand, attention.evidence));
      backtestEngine.onBandChange(meta.symbol, prevBand, displayBand, st.price);
    }

    // ------------------------------------------------------------
    // SIMULATED EVENT CONTEXT
    // ------------------------------------------------------------
    eventEngine.maybeAttachEvent(st, displayBand);

    st.history.push({ t: now, price: st.price, volume, score: displayScore });
    if (st.history.length > HISTORY_LIMIT) st.history.shift();

    // Recent move % over the trailing window — used for alerts and context.
    const windowIndex = Math.max(0, st.history.length - 1 - MOVE_WINDOW_TICKS);
    const windowStart = st.history[windowIndex];
    const recentMovePct =
      windowStart && windowStart.price > 0
        ? ((st.price - windowStart.price) / windowStart.price) * 100
        : 0;

    // Sector / market divergence classification.
    const sectorReturnPct = Number((sectorReturn * 100).toFixed(2));
    const marketReturnPct = Number((marketReturn * 100).toFixed(2));
    const sectorDivergencePct = Number(((ret - sectorReturn) * 100).toFixed(2));

    let divergenceType = "NONE";
    if (Math.abs(sectorDivergencePct) >= 1.2) {
      divergenceType = "COMPANY_SPECIFIC";
    } else if (Math.abs(marketReturnPct) >= 0.25 && Math.sign(ret) === Math.sign(marketReturn)) {
      divergenceType = "MARKET_WIDE";
    }

    st.lastSectorReturnPct = sectorReturnPct;
    st.lastMarketReturnPct = marketReturnPct;
    st.lastDivergenceType = divergenceType;
    st.lastRecentMovePct = Number(recentMovePct.toFixed(2));

    const update = {
      symbol: meta.symbol,
      name: meta.name,
      sector: meta.sector,
      price: Number(st.price.toFixed(2)),
      changePct: Number((ret * 100).toFixed(3)),
      recentMovePct: st.lastRecentMovePct,
      volume,
      volumeRatio: Number(volumeRatio.toFixed(2)),
      score: displayScore,
      band: displayBand,
      confidence: attention.confidence,
      evidence: attention.evidence,
      sectorReturnPct,
      marketReturnPct,
      sectorDivergencePct,
      divergenceType,
      activeEvent: st.activeEvent ? { type: st.activeEvent.type, text: st.activeEvent.text } : null,
      weekHigh: Number(st.weekHigh.toFixed(2)),
      weekLow: Number(st.weekLow.toFixed(2)),
    };

    updates.push(update);
    updatesBySymbol.set(meta.symbol, update);
  }

  // 3b) Live validation — resolve any signals whose evaluation window
  // has elapsed now that this tick's prices are final.
  backtestEngine.evaluateTick((symbol) => symbolState.get(symbol)?.price);

  broadcast({ type: "TICK", t: now, symbols: updates, sectorReturnAvg, marketReturnAvg });

  // 4) Smart alerts — evaluate each user's watchlist against their rules.
  for (const userId of watchlists.keys()) {
    const triggered = alertsEngine.evaluateAlerts(userId, updatesBySymbol);
    if (triggered.length > 0) {
      broadcast({ type: "ALERT", userId, alerts: triggered });
    }
  }
}

function start() {
  setInterval(tick, TICK_MS);
}

module.exports = { start, subscribers, triggerShock, TICK_MS };
