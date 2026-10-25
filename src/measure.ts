import { performance } from "node:perf_hooks";

import type { CaseDefinition, CaseName, Library } from "./cases.ts";
import type { Scale } from "./seed.ts";
import { latency } from "./statistics.ts";
import type { Latency } from "./statistics.ts";

/** One use case of one library to measure, and for how long. */
export interface Measurement {
  readonly library: Library;
  readonly definition: CaseDefinition<CaseName>;
  readonly scale: Scale;
  /** Unmeasured calls first, so pools fill and the JIT settles. */
  readonly warmUpMilliseconds: number;
  readonly measureMilliseconds: number;
  /** Runs between the warm-up and the measured calls, such as resetting statement statistics. */
  readonly beforeMeasuring: () => Promise<void>;
}

/** Calls the use case back to back until `milliseconds` pass; returns the next call's index. */
async function warmUp(measurement: Measurement): Promise<number> {
  const { library, definition, scale } = measurement;
  const end = performance.now() + measurement.warmUpMilliseconds;
  let index = 0;
  while (performance.now() < end) {
    await definition.call(library.cases, index, scale);
    index += 1;
  }
  return index;
}

/**
 * Calls the use case back to back, one at a time, and summarises the time each call took. The
 * measured calls continue the warm-up's argument sequence, so they do not repeat its rows, and
 * every library gets the same sequence.
 */
export async function measureCase(measurement: Measurement): Promise<Latency> {
  const first = await warmUp(measurement);
  await measurement.beforeMeasuring();
  return sample(measurement, first);
}

async function sample(measurement: Measurement, first: number): Promise<Latency> {
  const { library, definition, scale } = measurement;
  const samples: number[] = [];
  const start = performance.now();
  let now = start;
  for (let index = first; now - start < measurement.measureMilliseconds; index += 1) {
    const before = performance.now();
    await definition.call(library.cases, index, scale);
    now = performance.now();
    samples.push(now - before);
  }
  return latency(samples, now - start);
}
