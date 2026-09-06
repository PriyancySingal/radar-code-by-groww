// backtestEngine.js
//
// A live, continuously-running validation of the Attention Score.
//
// Every time a symbol's band RISES (crosses into WORTH_WATCHING or
// higher), we remember its price at that exact moment. After a fixed
// window of simulated time has passed, we check back: did price
// actually move by a meaningful amount from where it was when the
// signal fired?
//
// This number is never fabricated. It starts at 0 evaluated / no
// precision on a freshly started server and only grows as the
// simulator actually ticks forward and real (simulated) outcomes
// resolve — the same evaluation loop a genuine backtest against real
// market data would use, just running against our simulated feed
// instead of a historical CSV.
//
// "Confirmed" means: at least CONFIRM_THRESHOLD_PCT% absolute price
// move, in either direction, within EVAL_WINDOW_TICKS ticks of the
// signal firing.

const EVAL_WINDOW_TICKS = 15; // ~30s of simulated time at the 2s tick rate
const CONFIRM_THRESHOLD_PCT = 1.2;

const BAND_RANK = {
  NORMAL: 0,
  WORTH_WATCHING: 1,
  IMPORTANT: 2,
  HIGH_ATTENTION: 3,
};

const pending = []; // { symbol, band, triggerPrice, triggerTick }

let tickCount = 0;

const totals = {
  evaluated: 0,
  highAttentionSignals: 0,
  confirmedMoves: 0,
};

/**
 * Call this whenever a symbol's band changes. It only records a new
 * evaluation when the band actually ROSE (a fresh signal firing) —
 * a band cooling back down isn't a prediction to be graded.
 */
function onBandChange(symbol, prevBand, newBand, price) {
  const rose = BAND_RANK[newBand] > BAND_RANK[prevBand];

  if (rose && newBand !== "NORMAL" && Number.isFinite(price) && price > 0) {
    pending.push({
      symbol,
      band: newBand,
      triggerPrice: price,
      triggerTick: tickCount,
    });
  }
}

/**
 * Call once per simulator tick, after prices for this tick are final.
 * getPrice(symbol) should return the symbol's current price.
 */
function evaluateTick(getPrice) {
  tickCount += 1;

  for (let i = pending.length - 1; i >= 0; i--) {
    const entry = pending[i];

    if (tickCount - entry.triggerTick < EVAL_WINDOW_TICKS) continue;

    // Window has elapsed — resolve this evaluation one way or another.
    pending.splice(i, 1);

    const currentPrice = getPrice(entry.symbol);
    if (!Number.isFinite(currentPrice)) continue;

    const movePct = Math.abs(((currentPrice - entry.triggerPrice) / entry.triggerPrice) * 100);
    const confirmed = movePct >= CONFIRM_THRESHOLD_PCT;

    totals.evaluated += 1;

    if (entry.band === "HIGH_ATTENTION") {
      totals.highAttentionSignals += 1;
      if (confirmed) totals.confirmedMoves += 1;
    }
  }
}

function snapshot() {
  const precision =
    totals.highAttentionSignals > 0
      ? (totals.confirmedMoves / totals.highAttentionSignals) * 100
      : null;

  return {
    evaluated: totals.evaluated,
    highAttentionSignals: totals.highAttentionSignals,
    confirmedMoves: totals.confirmedMoves,
    precision: precision === null ? null : Number(precision.toFixed(1)),
    pendingCount: pending.length,
    windowTicks: EVAL_WINDOW_TICKS,
    thresholdPct: CONFIRM_THRESHOLD_PCT,
  };
}

module.exports = { onBandChange, evaluateTick, snapshot };
