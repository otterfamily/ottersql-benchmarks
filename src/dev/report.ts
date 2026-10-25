import { median } from "../statistics.ts";
import type { BundleSize } from "./bundle.ts";
import type { Footprint } from "./footprint.ts";
import type { Memory } from "./startup.ts";
import type { Generated, TypeCheck } from "./typecheck.ts";

/** One library's type checks and generations at one scale, a run each. */
export interface ScaleResult {
  readonly typeChecks: readonly TypeCheck[];
  readonly generated: readonly Generated[];
}

/** Everything a development-time run produced; parts that were not run are left out. */
export interface DevResults {
  readonly date: string;
  readonly machine: Readonly<Record<string, string | number>>;
  readonly settings: Readonly<Record<string, string | number>>;
  readonly versions: Readonly<Record<string, string>>;
  /** By library, then by number of tables. */
  readonly typeCheck?: Readonly<Record<string, Readonly<Record<string, ScaleResult>>>>;
  readonly footprint?: Readonly<Record<string, Footprint>>;
  readonly bundle?: Readonly<Record<string, BundleSize>>;
  /** Milliseconds per run, by library. */
  readonly coldStart?: Readonly<Record<string, readonly number[]>>;
  readonly memory?: Readonly<Record<string, Memory>>;
}

const MEGABYTE = 1_048_576;
const KILOBYTE = 1024;
const ONE_DECIMAL = 1;

function megabytes(bytes: number | null): string {
  return bytes === null ? "–" : (bytes / MEGABYTE).toFixed(ONE_DECIMAL);
}

function kilobytes(bytes: number): string {
  return (bytes / KILOBYTE).toFixed(ONE_DECIMAL);
}

function milliseconds(value: number): string {
  return Math.round(value).toString();
}

function table(header: readonly string[], rows: readonly (readonly string[])[]): string[] {
  return [
    `| ${header.join(" | ")} |`,
    `|${header.map((_cell, index) => (index === 0 ? "---" : "---:")).join("|")}|`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ];
}

function typeCheckRow(library: string, tables: string, result: ScaleResult): string[] {
  const of = (pick: (check: TypeCheck) => number): number => median(result.typeChecks.map(pick));
  const peaks = result.typeChecks.map((check) => check.peakBytes);
  const peak = peaks.includes(null) ? null : median(peaks.map((value) => value ?? 0));
  const generation =
    result.generated.length === 0
      ? "none"
      : milliseconds(median(result.generated.map((generated) => generated.milliseconds)));
  return [
    library,
    tables,
    milliseconds(of((check) => check.milliseconds)),
    megabytes(peak),
    of((check) => check.instantiations).toString(),
    of((check) => check.types).toString(),
    generation,
    kilobytes(result.generated[0]?.bytes ?? 0),
  ];
}

function typeCheckLines(results: DevResults): string[] {
  const rows = Object.entries(results.typeCheck ?? {}).flatMap(([library, scales]) =>
    Object.entries(scales).map(([tables, result]) => typeCheckRow(library, tables, result)),
  );
  return [
    "## Type checking",
    "",
    ...table(
      [
        "library",
        "tables",
        "tsc ms",
        "peak MB",
        "instantiations",
        "types",
        "generate ms",
        "generated KB",
      ],
      rows,
    ),
  ];
}

function runtimeLines(results: DevResults): string[] {
  const names = Object.keys(results.footprint ?? results.bundle ?? results.coldStart ?? {});
  const rows = names.map((name) => {
    const footprint = results.footprint?.[name];
    const bundle = results.bundle?.[name];
    const memory = results.memory?.[name];
    const coldStart = results.coldStart?.[name];
    return [
      name,
      footprint === undefined ? "–" : footprint.packages.toString(),
      footprint === undefined ? "–" : megabytes(footprint.bytes),
      bundle === undefined ? "–" : kilobytes(bundle.bytes),
      bundle === undefined ? "–" : kilobytes(bundle.gzipBytes),
      coldStart === undefined ? "–" : milliseconds(median(coldStart)),
      memory === undefined ? "–" : megabytes(memory.rss),
      memory === undefined ? "–" : megabytes(memory.heapUsed),
    ];
  });
  return [
    "## Installing and running",
    "",
    ...table(
      [
        "library",
        "packages",
        "installed MB",
        "bundle KB",
        "gzip KB",
        "first query ms",
        "RSS MB",
        "heap MB",
      ],
      rows,
    ),
  ];
}

/** The development-time results as Markdown tables. */
export function devReport(results: DevResults): string {
  return [
    `# Development-time results of ${results.date}`,
    "",
    ...Object.entries({ ...results.machine, ...results.settings, ...results.versions }).map(
      ([key, value]) => `- ${key}: ${String(value)}`,
    ),
    "",
    ...typeCheckLines(results),
    "",
    ...runtimeLines(results),
  ].join("\n");
}
