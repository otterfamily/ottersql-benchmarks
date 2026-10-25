/** A summary of the time each call took, in milliseconds. */
export interface Latency {
  readonly calls: number;
  readonly median: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
  readonly callsPerSecond: number;
}

const MEDIAN = 0.5;
const P95 = 0.95;
const P99 = 0.99;
const MILLISECONDS_PER_SECOND = 1000;

/** The value below which `fraction` of the sorted samples fall (nearest rank). */
function percentile(sorted: readonly number[], fraction: number): number {
  const rank = Math.ceil(fraction * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))] ?? Number.NaN;
}

/** Summarises samples in milliseconds, taken back to back over `elapsed` milliseconds. */
export function latency(samples: readonly number[], elapsed: number): Latency {
  const sorted = samples.toSorted((left, right) => left - right);
  return {
    calls: sorted.length,
    median: percentile(sorted, MEDIAN),
    p95: percentile(sorted, P95),
    p99: percentile(sorted, P99),
    max: sorted.at(-1) ?? Number.NaN,
    callsPerSecond: (sorted.length / elapsed) * MILLISECONDS_PER_SECOND,
  };
}

/** The median of several runs' values, which the report gives with their spread. */
export function median(values: readonly number[]): number {
  return percentile(
    values.toSorted((left, right) => left - right),
    MEDIAN,
  );
}
