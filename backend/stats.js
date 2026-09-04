// Welford's online algorithm: incremental mean/variance in O(1) per update,
// no need to ever replay full history. This is what lets the attention
// engine score every tick for every symbol without recomputation.
class RollingStats {
  constructor() {
    this.n = 0;
    this.mean = 0;
    this.M2 = 0;
  }

  update(x) {
    this.n += 1;
    const delta = x - this.mean;
    this.mean += delta / this.n;
    const delta2 = x - this.mean;
    this.M2 += delta * delta2;
  }

  variance() {
    return this.n > 1 ? this.M2 / (this.n - 1) : 0;
  }

  stdDev() {
    return Math.sqrt(this.variance());
  }

  // How many standard deviations is x from this stream's own normal?
  // Returns 0 until we have enough history to trust a stddev.
  zScore(x) {
    if (this.n < 8) return 0;
    const sd = this.stdDev();
    return sd > 1e-9 ? (x - this.mean) / sd : 0;
  }
}

module.exports = { RollingStats };
