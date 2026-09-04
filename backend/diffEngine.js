const { symbolState, ensureWatchlist, ensureLastSeen } = require("./store");

const BAND_RANK = { NORMAL: 0, WORTH_WATCHING: 1, IMPORTANT: 2, HIGH_ATTENTION: 3 };

function buildDigest(userId) {
  const wl = ensureWatchlist(userId);
  const seenMap = ensureLastSeen(userId);
  const changes = [];

  for (const symbol of wl) {
    const st = symbolState.get(symbol);
    if (!st) continue;
    const prev = seenMap.get(symbol);
    const current = {
      price: st.price,
      score: st.attention.score,
      band: st.attention.band,
    };

    if (!prev) {
      // Never seen before — informational, not a "change"
      continue;
    }

    const scoreDelta = current.score - prev.score;
    const bandRose = BAND_RANK[current.band] > BAND_RANK[prev.band];
    const priceDeltaPct = prev.price > 0 ? ((current.price - prev.price) / prev.price) * 100 : 0;

    const meaningful = bandRose || Math.abs(scoreDelta) >= 15 || Math.abs(priceDeltaPct) >= 1.5;

    if (meaningful) {
      changes.push({
        symbol,
        name: st.meta.name,
        prevScore: prev.score,
        currentScore: current.score,
        prevBand: prev.band,
        currentBand: current.band,
        priceDeltaPct: Number(priceDeltaPct.toFixed(2)),
        evidence: st.attention.evidence,
        narrative: buildNarrative(st, priceDeltaPct),
      });
    }
  }

  changes.sort((a, b) => b.currentScore - a.currentScore);
  return changes;
}

function buildNarrative(st, priceDeltaPct) {
  const dir = priceDeltaPct >= 0 ? "up" : "down";
  const topEvidence = st.attention.evidence[0];
  const base = `${st.meta.name} moved ${dir} ${Math.abs(priceDeltaPct).toFixed(1)}% since you last checked`;
  return topEvidence ? `${base} \u2014 ${topEvidence.text}.` : `${base}.`;
}

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

module.exports = { buildDigest, checkin };
