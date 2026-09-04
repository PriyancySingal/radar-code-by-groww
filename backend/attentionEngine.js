// Turns raw signals into a single explainable 0-100 Attention Score,
// plus the evidence trail that justifies it. No black box: every point
// on the score can be traced back to a stated reason.

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

// Squash a z-score-like quantity into 0-1 so it can be weighted fairly
// against other signals that live on different scales.
function squash(z, softCap = 4) {
  return clamp(Math.abs(z) / softCap, 0, 1);
}

function bandFor(score) {
  if (score >= 80) return "HIGH_ATTENTION";
  if (score >= 60) return "IMPORTANT";
  if (score >= 30) return "WORTH_WATCHING";
  return "NORMAL";
}

/**
 * @param {object} input
 *  priceReturn: latest tick return (fraction, e.g. 0.004)
 *  priceZ: z-score of priceReturn vs symbol's own rolling distribution
 *  volumeRatio: current volume / rolling average volume
 *  volumeZ: z-score of volume vs symbol's own rolling distribution
 *  sectorReturn, marketReturn: average return of sector / market right now
 *  dormancyMinutes: minutes since this symbol last crossed WORTH_WATCHING
 *  distanceToHighPct, distanceToLowPct: % distance to 52w high/low (can be negative if crossed)
 */
function computeAttentionScore(input) {
  const {
    symbol,
    priceReturn,
    priceZ,
    volumeRatio,
    volumeZ,
    sectorReturn,
    marketReturn,
    dormancyMinutes,
    distanceToHighPct,
    distanceToLowPct,
  } = input;

  const evidence = [];

  // 1) Price anomaly relative to the stock's own normal behaviour
  const priceComponent = squash(priceZ) * WEIGHTS.priceZ;
  if (Math.abs(priceZ) >= 1.5) {
    evidence.push({
      type: "PRICE_ANOMALY",
      text: `${Math.abs(priceZ).toFixed(1)}\u03C3 ${priceZ >= 0 ? "above" : "below"} its own recent return baseline`,
    });
  }

  // 2) Volume anomaly
  const volumeComponent = squash(volumeZ) * WEIGHTS.volumeZ;
  if (volumeRatio >= 1.8) {
    evidence.push({
      type: "VOLUME_ANOMALY",
      text: `Trading at ${volumeRatio.toFixed(1)}\u00D7 its average volume`,
    });
  }

  // 3) Sector & market divergence — is this stock-specific, or the whole tide?
  const divergenceVsSector = priceReturn - sectorReturn;
  const divergenceVsMarket = priceReturn - marketReturn;
  const divergenceMagnitude = Math.max(Math.abs(divergenceVsSector), Math.abs(divergenceVsMarket));
  const divergenceComponent = squash(divergenceMagnitude * 40) * WEIGHTS.divergence;
  if (Math.abs(divergenceVsSector) * 100 >= 1.2) {
    evidence.push({
      type: "SECTOR_DIVERGENCE",
      text: `${divergenceVsSector >= 0 ? "Outperforming" : "Underperforming"} its sector by ${Math.abs(divergenceVsSector * 100).toFixed(1)} percentage points`,
    });
  }

  // 4) Dormancy / surprise — quiet stocks that suddenly move matter more
  const dormancyComponent = clamp(dormancyMinutes / (60 * 24), 0, 1) * WEIGHTS.dormancy *
    squash(priceZ, 2.5); // only rewards dormancy if something is actually happening now
  if (dormancyMinutes > 60 * 12 && Math.abs(priceZ) >= 1.2) {
    evidence.push({
      type: "DORMANCY_BREAK",
      text: `First unusual move in ${Math.round(dormancyMinutes / 60)}h+ of otherwise quiet trading`,
    });
  }

  // 5) Threshold proximity — 52w high/low crossings
  let thresholdComponent = 0;
  if (distanceToHighPct <= 0) {
    thresholdComponent = WEIGHTS.threshold;
    evidence.push({ type: "THRESHOLD", text: "New 52-week high" });
  } else if (distanceToLowPct >= 0) {
    thresholdComponent = WEIGHTS.threshold;
    evidence.push({ type: "THRESHOLD", text: "New 52-week low" });
  } else if (distanceToHighPct <= 0.01) {
    thresholdComponent = WEIGHTS.threshold * 0.6;
    evidence.push({ type: "THRESHOLD", text: "Within 1% of its 52-week high" });
  }

  const rawScore =
    priceComponent + volumeComponent + divergenceComponent + dormancyComponent + thresholdComponent;

  const score = Math.round(clamp(rawScore, 0, 100));

  return {
    symbol,
    score,
    band: bandFor(score),
    evidence,
    components: {
      priceComponent: Math.round(priceComponent),
      volumeComponent: Math.round(volumeComponent),
      divergenceComponent: Math.round(divergenceComponent),
      dormancyComponent: Math.round(dormancyComponent),
      thresholdComponent: Math.round(thresholdComponent),
    },
  };
}

module.exports = { computeAttentionScore, bandFor };
