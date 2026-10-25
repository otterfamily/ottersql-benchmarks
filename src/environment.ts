import { mkdir, readFile, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release, totalmem } from "node:os";

import { POSTGRES_IMAGE } from "./database.ts";

const BYTES_PER_GIGABYTE = 1_073_741_824;
const JSON_INDENT = 2;

/** The machine results were measured on, which every result records. */
export function machine(): Readonly<Record<string, string | number>> {
  return {
    cpu: cpus()[0]?.model ?? "unknown",
    cores: cpus().length,
    memoryGigabytes: Math.round(totalmem() / BYTES_PER_GIGABYTE),
    os: `${platform()} ${release()} ${arch()}`,
    node: process.version,
    postgres: POSTGRES_IMAGE,
    note: "The libraries and Postgres (in Docker) share this one machine.",
  };
}

async function versionOf(name: string): Promise<string> {
  const manifest: unknown = JSON.parse(
    await readFile(new URL(`../node_modules/${name}/package.json`, import.meta.url), "utf8"),
  );
  return typeof manifest === "object" && manifest !== null && "version" in manifest
    ? String(manifest.version)
    : "unknown";
}

/** The installed versions of `packages`, by name. */
export async function versions(
  packages: readonly string[],
): Promise<Readonly<Record<string, string>>> {
  const pairs = await Promise.all(
    packages.map(async (name) => [name, await versionOf(name)] as const),
  );
  return Object.fromEntries(pairs);
}

/** Writes results to `results/raw/<prefix><date>.json` and returns the file's path. */
export async function writeResults(
  prefix: string,
  results: { readonly date: string },
): Promise<string> {
  const directory = new URL("../results/raw/", import.meta.url);
  await mkdir(directory, { recursive: true });
  const file = new URL(`${prefix}${results.date.replaceAll(":", "-")}.json`, directory);
  await writeFile(file, `${JSON.stringify(results, null, JSON_INDENT)}\n`);
  return file.pathname;
}
