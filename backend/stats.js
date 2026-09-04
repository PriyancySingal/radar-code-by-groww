// Welford's online algorithm.
//
// Why Welford?
// We need rolling statistics for every symbol on every market tick.
// Recomputing mean/variance from the entire history would become
// increasingly expensive as the number of users and symbols grows.
//
// Welford gives us:
//   - O(1) update time
//   - O(1) memory for the statistics themselves
//   - numerically stable variance calculation
//
// The attention engine uses these statistics to answer:
// "Is this movement unusual for THIS stock?"

class RollingStats {
  constructor(minSamples = 8) {
    this.n = 0;
    this.mean = 0;
    this.M2 = 0;
    this.minSamples = minSamples;
  }

  update(x) {
    if (!Number.isFinite(x)) return;

    this.n += 1;

    const delta = x - this.mean;
    this.mean += delta / this.n;

    const delta2 = x - this.mean;
    this.M2 += delta * delta2;
  }

  variance() {
    if (this.n < 2) return 0;

    return Math.max(0, this.M2 / (this.n - 1));
  }

  stdDev() {
    return Math.sqrt(this.variance());
  }

  /**
   * Whether we have enough observations to make a meaningful
   * statistical comparison.
   */
  isWarm() {
    return this.n >= this.minSamples;
  }

  /**
   * How many standard deviations x is away from this stream's
   * own historical mean.
   *
   * We deliberately return 0 during warm-up. This prevents the
   * system from pretending that a score is statistically meaningful
   * before enough observations exist.
   */
  zScore(x) {
    if (!this.isWarm()) return 0;

    const sd = this.stdDev();

    // A nearly-zero standard deviation means the series has been
    // effectively flat. Treat it as non-anomalous rather than
    // generating an artificially enormous z-score.
    if (sd <= 1e-9) return 0;

    return (x - this.mean) / sd;
  }

  /**
   * Return a small diagnostic object useful for debugging,
   * explainability and future monitoring.
   */
  snapshot() {
    return {
      n: this.n,
      mean: this.mean,
      variance: this.variance(),
      stdDev: this.stdDev(),
      warm: this.isWarm(),
      minSamples: this.minSamples,
    };
  }

  /**
   * Reset the stream if we ever need to start a new statistical
   * regime without replacing the object.
   */
  reset() {
    this.n = 0;
    this.mean = 0;
    this.M2 = 0;
  }
}

module.exports = { RollingStats };