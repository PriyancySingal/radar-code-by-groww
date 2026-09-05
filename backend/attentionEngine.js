// RADAR Attention Engine
//
// Core product principle:
// "We don't track prices. We track what's out of character."
//
// Every score is explainable. No black-box ML is required.
// The score combines:
//   1. Price anomaly relative to the stock's own behaviour
//   2. Unusual trading volume
//   3. Stock-specific divergence from sector/market
//   4. Dormancy / surprise
//   5. Important price-level proximity
//
// The output is a 0-100 Attention Score plus an evidence trail.

const WEIGHTS = {
  priceZ: 34,
  volumeZ: 22,
  divergence: 20,
  dormancy: 12,
  threshold: 12,
};

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Convert an anomaly-like value into a normalized 0-1 signal.
 *
 * We deliberately use a soft cap rather than allowing extreme
 * values to dominate the entire score.
 */
function squash(z, softCap = 4) {
  if (!Number.isFinite(z)) return 0;

  return clamp(Math.abs(z) / softCap, 0, 1);
}

function bandFor(score) {
  if (score >= 80) return "HIGH_ATTENTION";
  if (score >= 60) return "IMPORTANT";
  if (score >= 30) return "WORTH_WATCHING";
  return "NORMAL";
}

/**
 * Compute a single explainable Attention Score.
 *
 * @param {object} input
 *
 * priceReturn:
 *   Latest tick return as a fraction.
 *   Example: 0.004 = +0.4%
 *
 * priceZ:
 *   Latest return expressed in standard deviations from
 *   this stock's own rolling return distribution.
 *
 * volumeRatio:
 *   Current volume / normal volume.
 *
 * volumeZ:
 *   Volume anomaly relative to this stock's own history.
 *
 * sectorReturn:
 *   Current sector return.
 *
 * marketReturn:
 *   Current market return.
 *
 * dormancyMinutes:
 *   Time since this stock last entered a meaningful attention state.
 *
 * distanceToHighPct:
 *   Percentage distance from the current price to the 52-week high.
 *
 * distanceToLowPct:
 *   Percentage distance from the current price to the 52-week low.
 */
function computeAttentionScore(input) {
  const {
    symbol,
    priceReturn = 0,
    priceZ = 0,
    volumeRatio = 1,
    volumeZ = 0,
    sectorReturn = 0,
    marketReturn = 0,
    dormancyMinutes = 0,
    distanceToHighPct = 999,
    distanceToLowPct = 999,
    // Whether each rolling statistic has enough samples to be trusted.
    // Used only for the confidence estimate below — the score itself
    // already degrades gracefully during warm-up via RollingStats.zScore().
    priceWarm = false,
    volumeWarm = false,
  } = input;

  const evidence = [];

  // ============================================================
  // 1. PRICE ANOMALY
  // ============================================================
  //
  // Most important signal:
  // Is this move unusual FOR THIS STOCK?
  //
  // This is intentionally not:
  // "Did the stock move more than 2%?"
  //
  // It is:
  // "How unusual is this move compared with what this stock
  // normally does?"
  //
  const priceAnomaly = squash(priceZ, 4);

  const priceComponent =
    priceAnomaly * WEIGHTS.priceZ;

  if (Math.abs(priceZ) >= 1.5) {
    evidence.push({
      type: "PRICE_ANOMALY",
      severity: Math.min(100, Math.round(Math.abs(priceZ) / 4 * 100)),
      text:
        `${Math.abs(priceZ).toFixed(1)}σ ` +
        `${priceZ >= 0 ? "above" : "below"} ` +
        `its own recent return baseline`,
    });
  }

  // ============================================================
  // 2. VOLUME ANOMALY
  // ============================================================
  //
  // A price move accompanied by unusual participation is more
  // informative than an isolated price tick.
  //
  const safeVolumeRatio = Number.isFinite(volumeRatio)
    ? Math.max(0, volumeRatio)
    : 1;

  const volumeAnomaly = squash(volumeZ, 4);

  const volumeComponent =
    volumeAnomaly * WEIGHTS.volumeZ;

  if (safeVolumeRatio >= 1.8) {
    evidence.push({
      type: "VOLUME_ANOMALY",
      severity: Math.min(
        100,
        Math.round((safeVolumeRatio - 1) / 5 * 100)
      ),
      text:
        `Trading at ${safeVolumeRatio.toFixed(1)}× ` +
        `its average volume`,
    });
  }

  // ============================================================
  // 3. SECTOR / MARKET DIVERGENCE
  // ============================================================
  //
  // This answers an important question:
  //
  // "Is the stock moving because the whole market moved,
  // or is something specific happening to this stock?"
  //
  const divergenceVsSector =
    priceReturn - sectorReturn;

  const divergenceVsMarket =
    priceReturn - marketReturn;

  const sectorMagnitude =
    Math.abs(divergenceVsSector);

  const marketMagnitude =
    Math.abs(divergenceVsMarket);

  const divergenceMagnitude =
    Math.max(
      sectorMagnitude,
      marketMagnitude
    );

  // Convert percentage-point-like return difference into
  // an anomaly scale suitable for squash().
  const divergenceSignal =
    squash(divergenceMagnitude * 40, 4);

  const divergenceComponent =
    divergenceSignal * WEIGHTS.divergence;

  if (sectorMagnitude * 100 >= 1.2) {
    evidence.push({
      type: "SECTOR_DIVERGENCE",
      severity: Math.min(
        100,
        Math.round(sectorMagnitude * 100 * 25)
      ),
      text:
        `${divergenceVsSector >= 0 ? "Outperforming" : "Underperforming"} ` +
        `its sector by ` +
        `${Math.abs(divergenceVsSector * 100).toFixed(1)} ` +
        `percentage points`,
    });
  }

  if (marketMagnitude * 100 >= 1.5) {
    evidence.push({
      type: "MARKET_DIVERGENCE",
      severity: Math.min(
        100,
        Math.round(marketMagnitude * 100 * 20)
      ),
      text:
        `${divergenceVsMarket >= 0 ? "Outperforming" : "Underperforming"} ` +
        `the market by ` +
        `${Math.abs(divergenceVsMarket * 100).toFixed(1)} ` +
        `percentage points`,
    });
  }

  // ============================================================
  // 4. DORMANCY / SURPRISE
  // ============================================================
  //
  // A stock that has been quiet for a long time and suddenly
  // becomes statistically unusual deserves more attention.
  //
  // Dormancy alone never generates attention.
  //
  // This is important:
  //
  // quiet + quiet = NORMAL
  // quiet + unusual event = SURPRISE
  //
  const dormancyFactor =
    clamp(
      dormancyMinutes / (60 * 24),
      0,
      1
    );

  const dormancyComponent =
    dormancyFactor *
    WEIGHTS.dormancy *
    squash(priceZ, 2.5);

  if (
    dormancyMinutes > 60 * 12 &&
    Math.abs(priceZ) >= 1.2
  ) {
    evidence.push({
      type: "DORMANCY_BREAK",
      severity: Math.min(
        100,
        Math.round(dormancyFactor * 100)
      ),
      text:
        `First unusual move in ` +
        `${Math.round(dormancyMinutes / 60)}h+ ` +
        `of otherwise quiet trading`,
    });
  }

  // ============================================================
  // 5. IMPORTANT PRICE LEVELS
  // ============================================================
  //
  // We use 52-week extremes as contextual signals.
  //
  // Crossing a major level is stronger than merely approaching it.
  //
  let thresholdComponent = 0;

  if (distanceToHighPct <= 0) {
    thresholdComponent = WEIGHTS.threshold;

    evidence.push({
      type: "THRESHOLD",
      severity: 100,
      text: "New 52-week high",
    });
  } else if (distanceToLowPct <= 0) {
    thresholdComponent = WEIGHTS.threshold;

    evidence.push({
      type: "THRESHOLD",
      severity: 100,
      text: "New 52-week low",
    });
  } else if (distanceToHighPct <= 0.01) {
    thresholdComponent =
      WEIGHTS.threshold * 0.6;

    evidence.push({
      type: "THRESHOLD",
      severity: 60,
      text:
        "Within 1% of its 52-week high",
    });
  } else if (distanceToLowPct <= 0.01) {
    thresholdComponent =
      WEIGHTS.threshold * 0.6;

    evidence.push({
      type: "THRESHOLD",
      severity: 60,
      text:
        "Within 1% of its 52-week low",
    });
  }

  // ============================================================
  // FINAL SCORE
  // ============================================================

  const rawScore =
    priceComponent +
    volumeComponent +
    divergenceComponent +
    dormancyComponent +
    thresholdComponent;

  const score =
    Math.round(
      clamp(rawScore, 0, 100)
    );

  // ============================================================
  // EVIDENCE ORDERING
  // ============================================================
  //
  // Put the strongest explanations first so the UI can simply
  // display evidence[0] as the primary reason.
  //
  evidence.sort(
    (a, b) => b.severity - a.severity
  );

  // ============================================================
  // CONFIDENCE
  // ============================================================
  //
  // ATTENTION and CONFIDENCE answer two different questions:
  //   ATTENTION  = "how unusual/urgent is this?"
  //   CONFIDENCE = "how sure are we that this reading is trustworthy?"
  //
  // Confidence rises when multiple independent components agree
  // (price + volume + divergence all pointing the same direction is
  // more trustworthy than a single noisy component) and when the
  // underlying rolling statistics have enough samples to be meaningful.
  //
  const componentsEngaged = [
    priceComponent,
    volumeComponent,
    divergenceComponent,
    dormancyComponent,
    thresholdComponent,
  ].filter((c) => c >= 4).length;

  let confidence = 22 + componentsEngaged * 16;
  if (priceWarm) confidence += 6;
  if (volumeWarm) confidence += 6;

  confidence = Math.round(clamp(confidence, 5, 97));

  const components = {
    priceComponent: Math.round(priceComponent),
    volumeComponent: Math.round(volumeComponent),
    divergenceComponent: Math.round(divergenceComponent),
    dormancyComponent: Math.round(dormancyComponent),
    thresholdComponent: Math.round(thresholdComponent),
  };

  return {
    symbol,
    score,
    band: bandFor(score),

    confidence,
    evidence,

    components,

    // ============================================================
    // "NOTHING IS WRONG" — explicit reassurance for NORMAL stocks
    // ============================================================
    //
    // Product principle: don't just go quiet on a normal stock —
    // say so explicitly, otherwise the user is left wondering
    // whether RADAR is actually working. "Because nothing needs
    // your attention" is itself the answer.
    //
    normalChecklist: buildNormalChecklist(components),
  };
}

/**
 * A quiet component (below the same "engaged" threshold used for
 * confidence) means that dimension is behaving as expected.
 */
const QUIET_THRESHOLD = 4;

function buildNormalChecklist(components) {
  return [
    {
      ok: components.priceComponent < QUIET_THRESHOLD,
      label: "Price within expected range",
    },
    {
      ok: components.volumeComponent < QUIET_THRESHOLD,
      label: "Volume normal",
    },
    {
      ok: components.divergenceComponent < QUIET_THRESHOLD,
      label: "No significant sector divergence",
    },
    {
      ok: components.thresholdComponent < QUIET_THRESHOLD,
      label: "No threshold breach (52-week high/low)",
    },
  ];
}

module.exports = {
  computeAttentionScore,
  bandFor,
};