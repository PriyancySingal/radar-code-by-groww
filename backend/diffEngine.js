const { symbolState, ensureWatchlist, ensureLastSeen } = require("./store");

const BAND_RANK = {
  NORMAL: 0,
  WORTH_WATCHING: 1,
  IMPORTANT: 2,
  HIGH_ATTENTION: 3,
};

const MIN_MEANINGFUL_SCORE = 20;
const MIN_MEANINGFUL_PRICE_MOVE = 1.5;
const MIN_MEANINGFUL_SCORE_DELTA = 15;

/**
 * Build the "Since You Last Checked" digest.
 *
 * Important product principle:
 * We do NOT treat every price movement as meaningful.
 * A change deserves attention when it is:
 *   1. statistically/behaviorally significant,
 *   2. a meaningful attention-band change, or
 *   3. a large enough move to matter to the user.
 *
 * The Attention Score remains the primary signal.
 */
function buildDigest(userId) {
  const wl = ensureWatchlist(userId);
  const seenMap = ensureLastSeen(userId);
  const changes = [];

  for (const symbol of wl) {
    const st = symbolState.get(symbol);

    if (!st) continue;

    const prev = seenMap.get(symbol);

    // First visit: there is no previous state to compare against.
    if (!prev) continue;

    const current = {
      price: st.price,
      score: st.attention.score,
      band: st.attention.band,
    };

    const scoreDelta = current.score - prev.score;

    const bandRose =
      BAND_RANK[current.band] > BAND_RANK[prev.band];

    const bandDropped =
      BAND_RANK[current.band] < BAND_RANK[prev.band];

    const priceDeltaPct =
      prev.price > 0
        ? ((current.price - prev.price) / prev.price) * 100
        : 0;

    /*
     * Primary signal:
     * Did the stock become meaningfully attention-worthy?
     */
    const becameAttentionWorthy =
      current.score >= MIN_MEANINGFUL_SCORE &&
      current.score > prev.score;

    /*
     * Secondary signal:
     * Did its attention state change materially?
     */
    const meaningfulBandChange = bandRose;

    /*
     * Fallback:
     * Large absolute price move.
     *
     * This prevents an important real-world movement from
     * being hidden if the statistical model has not warmed up.
     */
    const meaningfulPriceMove =
      Math.abs(priceDeltaPct) >= MIN_MEANINGFUL_PRICE_MOVE;

    const meaningfulScoreChange =
      Math.abs(scoreDelta) >= MIN_MEANINGFUL_SCORE_DELTA &&
      current.score >= MIN_MEANINGFUL_SCORE;

    /*
     * We intentionally DO NOT surface:
     *
     * - tiny normal price movements
     * - score fluctuations around zero
     * - stocks becoming quieter
     *
     * This is the "attention is scarce" product decision.
     */
    const meaningful =
      meaningfulBandChange ||
      becameAttentionWorthy ||
      meaningfulScoreChange ||
      meaningfulPriceMove;

    if (!meaningful) continue;

    changes.push({
      symbol,
      name: st.meta.name,

      prevScore: prev.score,
      currentScore: current.score,
      scoreDelta: Number(scoreDelta.toFixed(1)),

      prevBand: prev.band,
      currentBand: current.band,

      priceDeltaPct: Number(priceDeltaPct.toFixed(2)),

      direction:
        priceDeltaPct > 0
          ? "up"
          : priceDeltaPct < 0
            ? "down"
            : "flat",

      bandRose,
      bandDropped,

      evidence: st.attention.evidence,

      narrative: buildNarrative(
        st,
        priceDeltaPct,
        scoreDelta,
        prev,
      ),

      timestamp: Date.now(),
    });
  }

  /*
   * Most urgent/attention-worthy changes first.
   */
  changes.sort((a, b) => {
    const bandDifference =
      BAND_RANK[b.currentBand] -
      BAND_RANK[a.currentBand];

    if (bandDifference !== 0) {
      return bandDifference;
    }

    return b.currentScore - a.currentScore;
  });

  return changes;
}

/**
 * Turn raw changes into a short human-readable explanation.
 */
function buildNarrative(st, priceDeltaPct, scoreDelta, prev) {
  const direction =
    priceDeltaPct > 0
      ? "up"
      : priceDeltaPct < 0
        ? "down"
        : "with little price movement";

  const evidence = st.attention.evidence || [];

  const topEvidence = evidence.length > 0
    ? evidence[0]
    : null;

  let base;

  if (Math.abs(priceDeltaPct) >= 0.05) {
    base =
      `${st.meta.name} moved ${direction} ` +
      `${Math.abs(priceDeltaPct).toFixed(1)}% since you last checked`;
  } else {
    base =
      `${st.meta.name}'s market behavior changed since you last checked`;
  }

  if (topEvidence && topEvidence.text) {
    return `${base} — ${topEvidence.text}.`;
  }

  if (scoreDelta > 0) {
    return `${base} — attention score increased from ${prev.score} to ${st.attention.score}.`;
  }

  return `${base}.`;
}

/**
 * Create a snapshot of the current watchlist state.
 *
 * This snapshot becomes the baseline for the next visit.
 */
function checkin(userId) {
  const wl = ensureWatchlist(userId);
  const seenMap = ensureLastSeen(userId);
  const now = Date.now();

  for (const symbol of wl) {
    const st = symbolState.get(symbol);

    if (!st) continue;

    seenMap.set(symbol, {
      price: st.price,
      score: st.attention.score,
      band: st.attention.band,
      timestamp: now,
    });
  }
}

module.exports = {
  buildDigest,
  checkin,
};