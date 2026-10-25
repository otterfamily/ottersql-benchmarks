import type { CaseName } from "./cases.ts";
import type { Statement } from "./database.ts";
import { median } from "./statistics.ts";
import type { Latency } from "./statistics.ts";

/** What one library did in one use case: a summary per run and the statements of the first run. */
export interface CaseResult {
  readonly runs: readonly Latency[];
  readonly statements: readonly Statement[];
}

/** Everything a benchmark run produced, written as JSON next to the table. */
export interface Results {
  readonly date: string;
  readonly machine: Readonly<Record<string, string | number>>;
  readonly settings: Readonly<Record<string, string | number | undefined>>;
  readonly versions: Readonly<Record<string, string>>;
  readonly cases: Partial<Record<CaseName, Readonly<Record<string, CaseResult>>>>;
}

const DIGITS = 3;
const RATIO_DIGITS = 2;

function milliseconds(value: number): string {
  return value.toFixed(DIGITS);
}

/** Statements Postgres ran per call of the use case, from the first measured run. */
function statementsPerCall(result: CaseResult): number {
  const calls = result.runs[0]?.calls ?? 0;
  const total = result.statements.reduce((sum, statement) => sum + statement.calls, 0);
  return calls === 0 ? 0 : total / calls;
}

function row(name: string, result: CaseResult, baseline: number): string {
  const medians = result.runs.map((run) => run.median);
  const value = median(medians);
  const spread = `${milliseconds(Math.min(...medians))}–${milliseconds(Math.max(...medians))}`;
  const cells = [
    name,
    milliseconds(value),
    spread,
    milliseconds(median(result.runs.map((run) => run.p99))),
    Math.round(median(result.runs.map((run) => run.callsPerSecond))).toString(),
    `${(value / baseline).toFixed(RATIO_DIGITS)}×`,
    statementsPerCall(result).toFixed(1),
  ];
  return `| ${cells.join(" | ")} |`;
}

/** The results as Markdown: one table per use case, compared with the first library (the baseline). */
export function report(results: Results): string {
  const lines = [
    `# Results of ${results.date}`,
    "",
    ...Object.entries({ ...results.machine, ...results.settings, ...results.versions }).map(
      ([key, value]) => `- ${key}: ${String(value)}`,
    ),
  ];
  for (const [name, byLibrary] of Object.entries(results.cases)) {
    const entries = Object.entries(byLibrary);
    const baseline = median(entries[0]?.[1].runs.map((run) => run.median) ?? []);
    lines.push(
      "",
      `## ${name}`,
      "",
      `| library | median ms | spread of run medians | p99 ms | calls/s | vs ${entries[0]?.[0] ?? ""} | statements/call |`,
      "|---|---:|---:|---:|---:|---:|---:|",
      ...entries.map(([library, result]) => row(library, result, baseline)),
    );
  }
  return lines.join("\n");
}
