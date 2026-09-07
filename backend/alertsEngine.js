// RADAR Smart Alerts
//
// Product principle:
//   Don't make the user watch the dashboard. Tell them the moment
//   something they actually care about happens.
//
// Rules are simple and per-user (only a single "demo-user" exists in
// this build, but the shape supports more):
//   - highAttention:          fire when a watchlist symbol hits HIGH_ATTENTION
//   - volumeMultiple:         fire when volume >= N x its own normal volume
//   - priceMovePct:           fire when the recent move (last ~30s of demo
//                             time) exceeds N%
//   - sectorDivergencePct:    fire when a symbol diverges from its sector
//                             by more than N percentage points
//
// A cooldown prevents the same symbol from re-alerting every tick while
// a condition continues to hold.

const { watchlists, ensureAlertRules, pushAlert, ensureReferenceLevels } = require("./store");

const COOLDOWN_MS = 45000;

// `${userId}:${symbol}` -> last alert timestamp
const cooldowns = new Map();

function evaluateAlerts(userId, updatesBySymbol) {
  const wl = watchlists.get(userId);
  if (!wl || wl.size === 0) return [];

  const rules = ensureAlertRules(userId);
  const now = Date.now();
  const triggered = [];

  for (const symbol of wl) {
    const upd = updatesBySymbol.get(symbol);
    if (!upd) continue;

    const key = `${userId}:${symbol}`;
    const lastAlertAt = cooldowns.get(key) || 0;
    if (now - lastAlertAt < COOLDOWN_MS) continue;

    const reasons = [];

    if (rules.highAttention && upd.band === "HIGH_ATTENTION") {
      reasons.push("Reached HIGH ATTENTION");
    }

    if (rules.volumeMultiple && upd.volumeRatio >= rules.volumeMultiple) {
      reasons.push(`Volume ${upd.volumeRatio.toFixed(1)}x normal`);
    }

    if (rules.priceMovePct && Math.abs(upd.recentMovePct) >= rules.priceMovePct) {
      reasons.push(
        `Price ${upd.recentMovePct >= 0 ? "up" : "down"} ${Math.abs(upd.recentMovePct).toFixed(
          1
        )}% recently`
      );
    }

    if (
      rules.sectorDivergencePct &&
      Math.abs(upd.sectorDivergencePct) >= rules.sectorDivergencePct
    ) {
      reasons.push(
        `Diverging from sector by ${Math.abs(upd.sectorDivergencePct).toFixed(1)}pp`
      );
    }

    // User-defined reference level (doc §4's "alert me at ₹1,500") —
    // personal to this user, so it lives here as an alert condition
    // rather than in the shared Attention Score.
    const refLevel = ensureReferenceLevels(userId).get(symbol);
    if (Number.isFinite(refLevel) && refLevel > 0 && Number.isFinite(upd.price)) {
      const proximityPct = (Math.abs(upd.price - refLevel) / refLevel) * 100;
      if (proximityPct <= 1) {
        reasons.push(`Within 1% of your ₹${refLevel} reference level (now ₹${upd.price.toFixed(2)})`);
      }
    }

    if (reasons.length === 0) continue;

    cooldowns.set(key, now);

    const alert = {
      id: `${symbol}-${now}`,
      symbol,
      name: upd.name,
      band: upd.band,
      score: upd.score,
      reasons,
      timestamp: now,
    };

    pushAlert(userId, alert);
    triggered.push(alert);
  }

  return triggered;
}

/**
 * Clears alert cooldowns. Used by the demo's "Reset scenario" control
 * so a fresh run isn't silently suppressed by a cooldown left over
 * from before the reset.
 */
function resetCooldowns() {
  cooldowns.clear();
}

module.exports = { evaluateAlerts, resetCooldowns };
