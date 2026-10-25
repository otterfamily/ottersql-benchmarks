// Runs every use case on every library and writes the results to results/raw/<time>.json, with
// a table on stdout. `pnpm bench --help` lists the options.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { parseArgs } from "node:util";

import { caseDefinitions } from "./cases.ts";
import type { CaseDefinition, CaseName, Library } from "./cases.ts";
import { POSTGRES_IMAGE, readStatements, resetStatements, startServer } from "./database.ts";
import type { Server } from "./database.ts";
import { libraries } from "./libraries.ts";
import { measureCase } from "./measure.ts";
import { report } from "./report.ts";
import type { CaseResult, Results } from "./report.ts";
import { realistic, tiny } from "./seed.ts";
import type { Scale } from "./seed.ts";

const POOL_SIZE = 10;
const MILLISECONDS_PER_SECOND = 1000;
const BYTES_PER_GIGABYTE = 1_073_741_824;
const MEDIAN_DIGITS = 3;
const JSON_INDENT = 2;
const MEASURED_PACKAGES = ["@ottersql/sql", "pg", "drizzle-orm", "kysely", "@prisma/client"];

const usage = `Options:
  --scale realistic|tiny   rows to seed (default realistic, about a million)
  --runs N                 times to repeat every measurement (default 5)
  --seconds N              measured seconds per use case and library (default 3)
  --cases a,b              only these use cases (default all)
  --libraries a,b          only these libraries (default all)`;

interface Plan {
  readonly scaleName: string;
  readonly scale: Scale;
  readonly runs: number;
  readonly seconds: number;
  readonly libraries: readonly string[];
  readonly definitions: readonly CaseDefinition<CaseName>[];
}

function chosen(list: string | undefined, all: readonly string[]): string[] {
  if (list === undefined) {
    return [...all];
  }
  const names = list.split(",");
  const unknown = names.filter((name) => !all.includes(name));
  if (unknown.length > 0) {
    throw new Error(`unknown ${unknown.join(", ")}; choose from ${all.join(", ")}`);
  }
  return all.filter((name) => names.includes(name));
}

/** The run the command line asks for, or `undefined` when it asks for help. */
function plan(): Plan | undefined {
  const { values } = parseArgs({
    options: {
      scale: { type: "string", default: "realistic" },
      runs: { type: "string", default: "5" },
      seconds: { type: "string", default: "3" },
      cases: { type: "string" },
      libraries: { type: "string" },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    return undefined;
  }
  const caseNames = chosen(
    values.cases,
    caseDefinitions.map((definition) => definition.name),
  );
  return {
    scaleName: values.scale,
    scale: values.scale === "tiny" ? tiny : realistic,
    runs: Number(values.runs),
    seconds: Number(values.seconds),
    libraries: chosen(values.libraries, Object.keys(libraries)),
    definitions: caseDefinitions.filter((definition) => caseNames.includes(definition.name)),
  };
}

type Recorded = Map<
  string,
  { runs: CaseResult["runs"][number][]; statements: CaseResult["statements"] }
>;

/** One use case of one library to measure in a run. */
interface Step {
  readonly server: Server;
  readonly readsUrl: string;
  readonly plan: Plan;
  readonly definition: CaseDefinition<CaseName>;
  readonly library: string;
}

/**
 * Adds a run's latency to what is recorded for `key`, with the statements Postgres ran in the
 * first run, and reports progress.
 */
async function record(
  recorded: Recorded,
  key: string,
  measured: { readonly run: CaseResult["runs"][number]; readonly url: string },
): Promise<void> {
  const previous = recorded.get(key);
  const statements = previous?.statements ?? (await readStatements(measured.url));
  recorded.set(key, { runs: [...(previous?.runs ?? []), measured.run], statements });
  console.error(`${key}: median ${measured.run.median.toFixed(MEDIAN_DIGITS)} ms`);
}

/** Measures one use case of one library, on a database of its own when it writes. */
async function measureOne(step: Step, recorded: Recorded): Promise<void> {
  const { definition, library } = step;
  const url = definition.writes
    ? await step.server.copy(`${definition.name.toLowerCase()}_${library}`)
    : step.readsUrl;
  const opened = await openLibrary(library, url);
  try {
    const result = await measureCase({
      library: opened,
      definition,
      scale: step.plan.scale,
      warmUpMilliseconds: MILLISECONDS_PER_SECOND,
      measureMilliseconds: step.plan.seconds * MILLISECONDS_PER_SECOND,
      beforeMeasuring: async () => resetStatements(url),
    });
    await record(recorded, `${definition.name}/${library}`, { run: result, url });
  } finally {
    await opened.close();
    if (definition.writes) {
      await step.server.drop(url);
    }
  }
}

async function openLibrary(library: string, url: string): Promise<Library> {
  const open = libraries[library];
  if (open === undefined) {
    throw new Error(`no library ${library}`);
  }
  return open(url, POOL_SIZE);
}

/** The libraries in the order of a run: rotated each run, so none always goes first. */
function rotated(names: readonly string[], run: number): string[] {
  return names.map((_name, position) => names[(position + run) % names.length] ?? "");
}

/** Every use case on every library, `runs` times. */
async function measureAll(server: Server, chosenPlan: Plan): Promise<Recorded> {
  const recorded: Recorded = new Map();
  const readsUrl = await server.copy("reads");
  for (let run = 0; run < chosenPlan.runs; run += 1) {
    console.error(`Run ${String(run + 1)} of ${String(chosenPlan.runs)}`);
    for (const definition of chosenPlan.definitions) {
      for (const library of rotated(chosenPlan.libraries, run)) {
        const step = { server, readsUrl, plan: chosenPlan, definition, library };
        await measureOne(step, recorded);
      }
    }
  }
  return recorded;
}

/** Seeds a server, measures everything on it, and stops it. */
async function measureOnNewServer(chosenPlan: Plan): Promise<Recorded> {
  console.error(`Starting ${POSTGRES_IMAGE} and seeding ${chosenPlan.scaleName}...`);
  const server = await startServer(chosenPlan.scale);
  try {
    return await measureAll(server, chosenPlan);
  } finally {
    await server.stop();
  }
}

async function versionOf(name: string): Promise<string> {
  const manifest: unknown = JSON.parse(
    await readFile(new URL(`../node_modules/${name}/package.json`, import.meta.url), "utf8"),
  );
  return typeof manifest === "object" && manifest !== null && "version" in manifest
    ? String(manifest.version)
    : "unknown";
}

async function resultsOf(chosenPlan: Plan, recorded: Recorded): Promise<Results> {
  const versions = await Promise.all(
    MEASURED_PACKAGES.map(async (name) => [name, await versionOf(name)] as const),
  );
  const cases = Object.fromEntries(
    chosenPlan.definitions.map((definition) => [
      definition.name,
      Object.fromEntries(
        chosenPlan.libraries.map((library) => [
          library,
          recorded.get(`${definition.name}/${library}`) ?? { runs: [], statements: [] },
        ]),
      ),
    ]),
  );
  return {
    date: new Date().toISOString(),
    machine: {
      cpu: cpus()[0]?.model ?? "unknown",
      cores: cpus().length,
      memoryGigabytes: Math.round(totalmem() / BYTES_PER_GIGABYTE),
      os: `${platform()} ${release()} ${arch()}`,
      node: process.version,
      postgres: POSTGRES_IMAGE,
      note: "The libraries and Postgres (in Docker) share this one machine.",
    },
    settings: {
      scale: chosenPlan.scaleName,
      runs: chosenPlan.runs,
      seconds: chosenPlan.seconds,
      poolSize: POOL_SIZE,
    },
    versions: Object.fromEntries(versions),
    cases,
  };
}

const chosenPlan = plan();
if (chosenPlan === undefined) {
  console.log(usage);
} else {
  const results = await resultsOf(chosenPlan, await measureOnNewServer(chosenPlan));
  const directory = new URL("../results/raw/", import.meta.url);
  await mkdir(directory, { recursive: true });
  const file = new URL(`${results.date.replaceAll(":", "-")}.json`, directory);
  await writeFile(file, `${JSON.stringify(results, null, JSON_INDENT)}\n`);
  console.log(report(results));
  console.error(`Wrote ${file.pathname}`);
}
