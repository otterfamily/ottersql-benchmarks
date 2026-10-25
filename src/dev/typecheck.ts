import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { measured, succeeded } from "./process.ts";
import { projectFiles } from "./projects.ts";
import type { DevLibrary } from "./projects.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const tsc = join(root, "node_modules", ".bin", "tsc");
const prisma = join(root, "node_modules", ".bin", "prisma");

/** A project written to disk, removed by `remove`. */
export interface WrittenProject {
  readonly directory: string;
  readonly library: DevLibrary;
  readonly remove: () => Promise<void>;
}

/**
 * Writes `library`'s project with `tables` tables to a new directory. Its `node_modules` links to
 * this repository's, so every project resolves the versions the lockfile pins without installing.
 */
export async function writeProject(library: DevLibrary, tables: number): Promise<WrittenProject> {
  const directory = await mkdtemp(join(tmpdir(), `ottersql-dev-${library}-`));
  for (const [path, content] of Object.entries(projectFiles(library, tables))) {
    await mkdir(dirname(join(directory, path)), { recursive: true });
    await writeFile(join(directory, path), content);
  }
  await symlink(join(root, "node_modules"), join(directory, "node_modules"), "dir");
  return {
    directory,
    library,
    remove: async () => rm(directory, { recursive: true, force: true }),
  };
}

/** What a code generator wrote: its time and the files it left in the project. */
export interface Generated {
  readonly milliseconds: number;
  readonly files: number;
  readonly bytes: number;
  readonly lines: number;
}

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

async function sizeOf(directory: string): Promise<Omit<Generated, "milliseconds">> {
  const paths = await filesUnder(directory);
  const contents = await Promise.all(paths.map(async (path) => readFile(path, "utf8")));
  return {
    files: contents.length,
    bytes: contents.reduce((sum, content) => sum + Buffer.byteLength(content), 0),
    lines: contents.reduce((sum, content) => sum + content.split("\n").length, 0),
  };
}

/** Runs the library's code generator, if it has one: only Prisma generates code before checking. */
export async function generate(project: WrittenProject): Promise<Generated | null> {
  if (project.library !== "prisma") {
    return null;
  }
  const ran = await succeeded(prisma, ["generate", "--schema", "schema.prisma"], project.directory);
  return {
    milliseconds: ran.milliseconds,
    ...(await sizeOf(join(project.directory, "generated"))),
  };
}

/** What one type check of a project cost. */
export interface TypeCheck {
  readonly milliseconds: number;
  /** The largest resident memory of tsc and the processes it waited for, such as a content mapper. */
  readonly peakBytes: number | null;
  readonly types: number;
  readonly instantiations: number;
  /** The checker's own heap, as tsc reports it. */
  readonly memoryUsedBytes: number;
}

const KILOBYTE = 1024;

function diagnostic(output: string, name: string): number {
  const value = new RegExp(`^${name}:\\s+(?<value>\\d+)`, "mv").exec(output)?.groups?.["value"];
  if (value === undefined) {
    throw new Error(`tsc reported no ${name}:\n${output}`);
  }
  return Number(value);
}

/**
 * Type-checks the project as its users would, with `--runExternalCode` where TypeScript must run
 * ottersql's content mapper, and fails unless the project is free of errors.
 */
export async function typeCheck(project: WrittenProject): Promise<TypeCheck> {
  const external = project.library === "ottersql" ? ["--runExternalCode"] : [];
  const ran = await measured(
    tsc,
    ["-p", ".", "--extendedDiagnostics", ...external],
    project.directory,
  );
  if (ran.exitCode !== 0) {
    throw new Error(`${project.library} does not type-check:\n${ran.stdout}${ran.stderr}`);
  }
  return {
    milliseconds: ran.milliseconds,
    peakBytes: ran.peakBytes,
    types: diagnostic(ran.stdout, "Types"),
    instantiations: diagnostic(ran.stdout, "Instantiations"),
    memoryUsedBytes: diagnostic(ran.stdout, "Memory used") * KILOBYTE,
  };
}
