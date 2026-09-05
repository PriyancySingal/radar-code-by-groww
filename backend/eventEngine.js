// RADAR Event / Context Engine
//
// Product principle (from the roadmap):
//   "RADAR detects the anomaly. RADAR then tries to explain the anomaly."
//
// This module never invents facts about a real company. It simulates the
// KIND of context that would normally explain a statistical anomaly
// (earnings, corporate actions, block deals, analyst notes) so the demo
// can show a believable "possible context" section next to every signal.
// In a production version this module would be replaced by a real
// news/corporate-action feed matched to the symbol and time window.

const EVENT_TYPES = [
  { type: "EARNINGS", text: "Earnings announcement detected" },
  { type: "CORP_ACTION", text: "Corporate action reported (bonus / split / buyback chatter)" },
  { type: "REGULATORY", text: "Regulatory or policy headline detected" },
  { type: "BLOCK_DEAL", text: "Large block / bulk deal detected" },
  { type: "ANALYST", text: "Analyst upgrade or downgrade circulating" },
];

// How long a simulated event stays "active" and eligible to show up in
// the possible-context list before it's considered stale.
const EVENT_TTL_MS = 45000;

function randomEventType() {
  return EVENT_TYPES[Math.floor(Math.random() * EVENT_TYPES.length)];
}

/**
 * Attach a (possibly explicit) simulated event to a symbol's state.
 * Used by the manual "Trigger shock" demo control and by the
 * spontaneous-event logic below.
 */
function attachEvent(st, explicitType = null) {
  const found = explicitType
    ? EVENT_TYPES.find((e) => e.type === explicitType)
    : null;
  const ev = found || randomEventType();

  st.activeEvent = {
    type: ev.type,
    text: ev.text,
    since: Date.now(),
    expiresAt: Date.now() + EVENT_TTL_MS,
  };

  return st.activeEvent;
}

/**
 * Drop the active event once it has aged out, so stale context doesn't
 * linger in the explanation panel forever.
 */
function clearExpiredEvent(st, now = Date.now()) {
  if (st.activeEvent && st.activeEvent.expiresAt < now) {
    st.activeEvent = null;
  }
}

/**
 * When a symbol organically crosses into IMPORTANT / HIGH_ATTENTION
 * (i.e. not from a manually triggered shock), there's a good chance a
 * real desk would have *some* explanation on hand. We simulate that by
 * probabilistically attaching a plausible event, purely for demo realism.
 */
function maybeAttachEvent(st, band, chance = 0.55) {
  if (st.activeEvent) return;
  if ((band === "IMPORTANT" || band === "HIGH_ATTENTION") && Math.random() < chance) {
    attachEvent(st);
  }
}

/**
 * Build the human-readable "POSSIBLE CONTEXT" list shown under a signal.
 * This is deliberately ordered from most to least specific:
 *   1. a concrete simulated event (if any)
 *   2. sector-level backdrop
 *   3. divergence classification (company-specific vs market-wide)
 *   4. an honest fallback when nothing explains the move
 */
function buildPossibleContext({
  symbol,
  sector,
  st,
  stockReturnPct = 0,
  sectorReturnPct = 0,
  divergenceType = "NONE",
}) {
  const context = [];

  if (st.activeEvent) {
    context.push(st.activeEvent.text);
  }

  if (Number.isFinite(sectorReturnPct)) {
    context.push(
      `${sector} sector is ${sectorReturnPct >= 0 ? "up" : "down"} ${Math.abs(
        sectorReturnPct
      ).toFixed(1)}%`
    );
  }

  if (divergenceType === "COMPANY_SPECIFIC") {
    const outperforming = stockReturnPct >= sectorReturnPct;
    context.push(
      `${symbol} is significantly ${
        outperforming ? "outperforming" : "underperforming"
      } its sector`
    );
  } else if (divergenceType === "MARKET_WIDE") {
    context.push("Move looks broadly market-wide rather than stock-specific");
  }

  if (context.length === 0) {
    context.push("No specific news detected — likely a statistical / technical move");
  }

  return context;
}

module.exports = {
  EVENT_TYPES,
  attachEvent,
  clearExpiredEvent,
  maybeAttachEvent,
  buildPossibleContext,
};
