import { lstat, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { succeeded } from "./process.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));

/** The packages a minimal application of each library installs to run its queries on Postgres. */
export const minimalApps: Readonly<Record<string, readonly string[]>> = {
  pg: ["pg"],
  ottersql: ["@ottersql/sql", "pg"],
  drizzle: ["drizzle-orm", "pg"],
  kysely: ["kysely", "pg"],
  prisma: ["@prisma/client", "@prisma/adapter-pg", "pg"],
};

/** What a production install of an application brings in. */
export interface Footprint {
  readonly packages: number;
  readonly bytes: number;
}

async function installedVersion(name: string): Promise<string> {
  const manifest: unknown = JSON.parse(
    await readFile(join(root, "node_modules", name, "package.json"), "utf8"),
  );
  if (typeof manifest !== "object" || manifest === null || !("version" in manifest)) {
    throw new Error(`${name} has no version`);
  }
  return String(manifest.version);
}

// Install scripts stay off as in this repository; ottersql 0.1.1 is newer than pnpm's minimum
// release age, as the repository's workspace file allows too.
const workspace = `allowBuilds:
  "@prisma/engines": false
  prisma: false
minimumReleaseAgeExclude:
  - "@ottersql/sql@0.1.1"
`;

async function bytesUnder(directory: string): Promise<number> {
  let bytes = 0;
  for (const name of await readdir(directory, { recursive: true })) {
    const entry = await lstat(join(directory, name));
    if (entry.isFile()) {
      bytes += entry.size;
    }
  }
  return bytes;
}

async function install(directory: string, packages: readonly string[]): Promise<void> {
  const versions = await Promise.all(
    packages.map(async (name) => [name, await installedVersion(name)] as const),
  );
  const manifest = { name: "app", private: true, dependencies: Object.fromEntries(versions) };
  await writeFile(join(directory, "package.json"), JSON.stringify(manifest));
  await writeFile(join(directory, "pnpm-workspace.yaml"), workspace);
  await succeeded("pnpm", ["install", "--prod", "--prefer-offline"], directory);
}

/**
 * Installs the application's packages, at the versions this repository pins, into a new directory
 * and measures what pnpm puts in `node_modules/.pnpm`: one entry per package, every file counted
 * once. pnpm's store serves packages it already has, so only new ones reach the network.
 */
export async function footprint(packages: readonly string[]): Promise<Footprint> {
  const directory = await mkdtemp(join(tmpdir(), "ottersql-footprint-"));
  try {
    await install(directory, packages);
    const store = join(directory, "node_modules", ".pnpm");
    const entries = await readdir(store, { withFileTypes: true });
    const installed = entries.filter(
      (entry) => entry.isDirectory() && entry.name !== "node_modules",
    );
    return { packages: installed.length, bytes: await bytesUnder(store) };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
