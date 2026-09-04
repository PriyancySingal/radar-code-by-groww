const { symbolState, HISTORY_LIMIT } = require("./store");
const { computeAttentionScore } = require("./attentionEngine");
const { SYMBOLS } = require("./symbols");

const TICK_MS = 2000; // accelerated vs real markets — a demo can't wait for real volatility
const subscribers = new Set(); // SSE response objects

const SECTORS = [...new Set(SYMBOLS.map((s) => s.sector))];

// Pending manual shocks requested via the API (demo control).
// A shock decays over several ticks instead of firing for a single 2s tick,
// so it's actually visible (and clickable) during a live demo.
const SHOCK_DECAY = [1, 0.8, 0.55, 0.35, 0.18, 0.08];
const pendingShocks = new Map(); // symbol -> { step, magnitude, volumeMultiplier }

function gaussianRandom() {
  // Box-Muller — good enough for a demo-realistic random walk
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function triggerShock(symbol, { direction = 1, magnitude = 0.045, volumeMultiplier = 6 } = {}) {
  pendingShocks.set(symbol, { step: 0, magnitude: magnitude * direction, volumeMultiplier });
}

function broadcast(payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of subscribers) {
    res.write(data);
  }
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
  for (const meta of SYMBOLS) {
    const st = symbolState.get(meta.symbol);
    const { ret, volumeMultiplier } = returns[meta.symbol];

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

    const prevBand = st.attention.band;
    const dormancyMinutes = (now - st.dormancySince) / 60000;

    const attention = computeAttentionScore({
      symbol: meta.symbol,
      priceReturn: ret,
      priceZ,
      volumeRatio,
      volumeZ,
      sectorReturn: sectorReturnAvg[meta.sector],
      marketReturn: marketReturnAvg,
      dormancyMinutes,
      distanceToHighPct,
      distanceToLowPct: -distanceToLowPct, // negative distance-to-low means "at/above" — keep low crossing symmetric
    });

    st.attention = attention;

    // Reset the dormancy clock whenever this symbol becomes notable again
    if (attention.band !== "NORMAL") {
      st.dormancySince = now;
    }

    st.history.push({ t: now, price: st.price, volume, score: attention.score });
    if (st.history.length > HISTORY_LIMIT) st.history.shift();

    updates.push({
      symbol: meta.symbol,
      name: meta.name,
      sector: meta.sector,
      price: Number(st.price.toFixed(2)),
      changePct: Number((ret * 100).toFixed(3)),
      volume,
      volumeRatio: Number(volumeRatio.toFixed(2)),
      score: attention.score,
      band: attention.band,
      evidence: attention.evidence,
      weekHigh: Number(st.weekHigh.toFixed(2)),
      weekLow: Number(st.weekLow.toFixed(2)),
    });
  }

  broadcast({ type: "TICK", t: now, symbols: updates, sectorReturnAvg, marketReturnAvg });
}

function start() {
  setInterval(tick, TICK_MS);
}

module.exports = { start, subscribers, triggerShock, TICK_MS };
