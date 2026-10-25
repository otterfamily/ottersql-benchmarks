// Measures what each library costs while developing and shipping an application, and writes the
// results to results/raw/dev-<time>.json with tables on stdout. `pnpm bench:dev --help` lists the
// options.
import { parseArgs } from "node:util";

import { startServer } from "../database.ts";
import type { Server } from "../database.ts";
import { machine, versions, writeResults } from "../environment.ts";
import { tiny } from "../seed.ts";
import { bundleEntries, bundleSize } from "./bundle.ts";
import type { BundleSize } from "./bundle.ts";
import { footprint, minimalApps } from "./footprint.ts";
import type { Footprint } from "./footprint.ts";
import { devLibraries } from "./projects.ts";
import type { DevLibrary } from "./projects.ts";
import { devReport } from "./report.ts";
import type { DevResults, ScaleResult } from "./report.ts";
import { coldStart, memoryAfterCalls } from "./startup.ts";
import type { Memory } from "./startup.ts";
import { generate, typeCheck, writeProject } from "./typecheck.ts";
import type { Generated, TypeCheck } from "./typecheck.ts";

const parts = ["typecheck", "footprint", "bundle", "start", "memory"] as const;
type Part = (typeof parts)[number];

const MEASURED_PACKAGES = [
  "@ottersql/sql",
  "@ottersql/content-mapper",
  "pg",
  "drizzle-orm",
  "kysely",
  "@prisma/client",
  "prisma",
  "typescript",
  "esbuild",
];

const usage = `Options:
  --parts a,b     typecheck, footprint, bundle, start, memory (default all)
  --tables a,b    tables in the type-checked schemas (default 10,100,500)
  --runs N        type checks and cold starts per library (default 3 and 5)`;

interface Plan {
  readonly parts: readonly Part[];
  readonly tables: readonly number[];
  readonly runs: number | null;
}

function plan(): Plan | undefined {
  const { values } = parseArgs({
    options: {
      parts: { type: "string" },
      tables: { type: "string", default: "10,100,500" },
      runs: { type: "string" },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    return undefined;
  }
  const chosen = values.parts?.split(",") ?? [...parts];
  const unknown = chosen.filter((name) => !parts.some((part) => part === name));
  if (unknown.length > 0) {
    throw new Error(`unknown parts ${unknown.join(", ")}; choose from ${parts.join(", ")}`);
  }
  return {
    parts: parts.filter((part) => chosen.includes(part)),
    tables: values.tables.split(",").map(Number),
    runs: values.runs === undefined ? null : Number(values.runs),
  };
}

/** One type check of `library` at `tables` tables, on a fresh project so no cache is reused. */
async function checkOnce(
  library: DevLibrary,
  tables: number,
): Promise<{ check: TypeCheck; generated: Generated | null }> {
  const project = await writeProject(library, tables);
  try {
    const generated = await generate(project);
    return { check: await typeCheck(project), generated };
  } finally {
    await project.remove();
  }
}

async function checkScale(library: DevLibrary, tables: number, runs: number): Promise<ScaleResult> {
  const typeChecks: TypeCheck[] = [];
  const generated: Generated[] = [];
  for (let run = 0; run < runs; run += 1) {
    const result = await checkOnce(library, tables);
    typeChecks.push(result.check);
    if (result.generated !== null) {
      generated.push(result.generated);
    }
    console.error(
      `${library} ${String(tables)} tables: tsc ${Math.round(result.check.milliseconds).toString()} ms`,
    );
  }
  return { typeChecks, generated };
}

const TYPE_CHECK_RUNS = 3;
const COLD_START_RUNS = 5;

async function measureTypeChecks(chosenPlan: Plan): Promise<DevResults["typeCheck"]> {
  const results: Record<string, Record<string, ScaleResult>> = {};
  for (const tables of chosenPlan.tables) {
    for (const library of devLibraries) {
      const byScale = results[library] ?? {};
      byScale[String(tables)] = await checkScale(
        library,
        tables,
        chosenPlan.runs ?? TYPE_CHECK_RUNS,
      );
      results[library] = byScale;
    }
  }
  return results;
}

async function measureEach<Value>(
  names: readonly string[],
  measureOne: (name: string) => Promise<Value>,
): Promise<Record<string, Value>> {
  const results: Record<string, Value> = {};
  for (const name of names) {
    results[name] = await measureOne(name);
    console.error(`${name}: measured`);
  }
  return results;
}

async function coldStarts(url: string, runs: number): Promise<Record<string, number[]>> {
  return measureEach(Object.keys(minimalApps), async (library) => {
    const times: number[] = [];
    for (let run = 0; run < runs; run += 1) {
      times.push(await coldStart(library, url));
    }
    return times;
  });
}

/** Cold starts and memory, which need a database; started only when one of them is chosen. */
async function measureProcesses(
  chosenPlan: Plan,
): Promise<Pick<DevResults, "coldStart" | "memory">> {
  if (!chosenPlan.parts.includes("start") && !chosenPlan.parts.includes("memory")) {
    return {};
  }
  const server: Server = await startServer(tiny);
  try {
    const url = await server.copy("dev");
    const starts = chosenPlan.parts.includes("start")
      ? await coldStarts(url, chosenPlan.runs ?? COLD_START_RUNS)
      : undefined;
    const memory: Record<string, Memory> | undefined = chosenPlan.parts.includes("memory")
      ? await measureEach(Object.keys(minimalApps), async (library) =>
          memoryAfterCalls(library, url),
        )
      : undefined;
    return {
      ...(starts === undefined ? {} : { coldStart: starts }),
      ...(memory === undefined ? {} : { memory }),
    };
  } finally {
    await server.stop();
  }
}

async function measureBuilds(chosenPlan: Plan): Promise<Pick<DevResults, "bundle" | "footprint">> {
  const installed: Record<string, Footprint> | undefined = chosenPlan.parts.includes("footprint")
    ? await measureEach(Object.keys(minimalApps), async (name) =>
        footprint(minimalApps[name] ?? []),
      )
    : undefined;
  const bundled: Record<string, BundleSize> | undefined = chosenPlan.parts.includes("bundle")
    ? await measureEach(Object.keys(bundleEntries), async (name) =>
        bundleSize(bundleEntries[name] ?? ""),
      )
    : undefined;
  return {
    ...(installed === undefined ? {} : { footprint: installed }),
    ...(bundled === undefined ? {} : { bundle: bundled }),
  };
}

async function measure(chosenPlan: Plan): Promise<DevResults> {
  const typeChecked = chosenPlan.parts.includes("typecheck")
    ? await measureTypeChecks(chosenPlan)
    : undefined;
  return {
    date: new Date().toISOString(),
    machine: machine(),
    settings: { parts: chosenPlan.parts.join(","), tables: chosenPlan.tables.join(",") },
    versions: await versions(MEASURED_PACKAGES),
    ...(typeChecked === undefined ? {} : { typeCheck: typeChecked }),
    ...(await measureBuilds(chosenPlan)),
    ...(await measureProcesses(chosenPlan)),
  };
}

const chosenPlan = plan();
if (chosenPlan === undefined) {
  console.log(usage);
} else {
  const results = await measure(chosenPlan);
  const file = await writeResults("dev-", results);
  console.log(devReport(results));
  console.error(`Wrote ${file}`);
}
