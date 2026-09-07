// RADAR Signal Timeline
//
// Product principle:
//   "What actually happened?" rather than only "What is happening now?"
//
// We keep a short in-memory history of attention-BAND transitions for
// every symbol. Every time a symbol's decayed attention band changes
// (NORMAL -> WORTH_WATCHING -> IMPORTANT -> HIGH_ATTENTION -> cooling
// back down), we record a timestamped entry. The frontend renders this
// underneath the sparkline as a vertical timeline.

const MAX_EVENTS_PER_SYMBOL = 40;

// symbol -> [{ t, band, text }]
const timelines = new Map();

function recordEvent(symbol, band, text) {
  if (!timelines.has(symbol)) timelines.set(symbol, []);
  const arr = timelines.get(symbol);

  arr.push({ t: Date.now(), band, text });

  if (arr.length > MAX_EVENTS_PER_SYMBOL) {
    arr.shift();
  }
}

function getTimeline(symbol) {
  return timelines.get(symbol) || [];
}

/**
 * Clears every symbol's recorded timeline. Used by the demo's
 * "Reset scenario" control.
 */
function reset() {
  timelines.clear();
}

module.exports = {
  recordEvent,
  getTimeline,
  reset,
};
