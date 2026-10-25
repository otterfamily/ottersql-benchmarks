import { spawn } from "node:child_process";
import { once } from "node:events";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { succeeded } from "./process.ts";

const child = fileURLToPath(new URL("child.ts", import.meta.url));
const root = fileURLToPath(new URL("../../", import.meta.url));

/** Node's flags for an application of `library`: only ottersql's needs the `.sql` loader. */
function nodeFlags(library: string): string[] {
  return library === "ottersql" ? ["--import", "@ottersql/sql/register"] : [];
}

/**
 * Milliseconds from starting a Node process for `library` to the result of its first query, which
 * includes loading the library, opening a connection and Postgres planning the query.
 */
export async function coldStart(library: string, url: string): Promise<number> {
  const start = performance.now();
  const process = spawn("node", [...nodeFlags(library), child, library, url, "first"], {
    cwd: root,
  });
  const received: unknown[] = await once(process.stdout, "data");
  const [chunk] = received;
  const elapsed = performance.now() - start;
  await once(process, "close");
  if (String(chunk) !== "first query done\n" || process.exitCode !== 0) {
    throw new Error(`${library} did not finish its first query: ${String(chunk)}`);
  }
  return elapsed;
}

/** Memory a process for `library` holds after 10,000 queries and a garbage collection, in bytes. */
export interface Memory {
  readonly rss: number;
  readonly heapUsed: number;
}

function isMemory(value: unknown): value is Memory {
  return typeof value === "object" && value !== null && "rss" in value && "heapUsed" in value;
}

export async function memoryAfterCalls(library: string, url: string): Promise<Memory> {
  const args = ["--expose-gc", ...nodeFlags(library), child, library, url, "memory"];
  const ran = await succeeded("node", args, root);
  const memory: unknown = JSON.parse(ran.stdout);
  if (!isMemory(memory)) {
    throw new Error(`${library} reported no memory: ${ran.stdout}`);
  }
  return memory;
}
