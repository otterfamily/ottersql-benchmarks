// Runs in a fresh process: loads one library, so the time and memory measured are that library's
// alone, and reports on stdout. `first` prints once the first query returns; `memory` makes many
// calls and prints the memory left in use after a garbage collection.
import type { OpenLibrary } from "../cases.ts";

const modules: Readonly<Record<string, () => Promise<OpenLibrary>>> = {
  pg: async () => {
    const { openPg } = await import("../pg/library.ts");
    return openPg;
  },
  ottersql: async () => {
    const { openOttersql } = await import("../ottersql/library.ts");
    return openOttersql;
  },
  drizzle: async () => {
    const { openDrizzle } = await import("../drizzle/library.ts");
    return openDrizzle;
  },
  kysely: async () => {
    const { openKysely } = await import("../kysely/library.ts");
    return openKysely;
  },
  prisma: async () => {
    const { openPrisma } = await import("../prisma/library.ts");
    return openPrisma;
  },
};

const POOL_SIZE = 10;
const MEMORY_CALLS = 10_000;
// The calls cycle through the first users, all of which every seed has.
const USERS = 10;
// Node's own path and this script's come before the arguments.
const FIRST_ARGUMENT = 2;

const [name = "", url = "", mode = "first"] = process.argv.slice(FIRST_ARGUMENT);
const load = modules[name];
if (load === undefined) {
  throw new Error(`no library ${name}`);
}
const library = await (await load())(url, POOL_SIZE);
try {
  await library.cases.userById({ id: 1 });
  if (mode === "first") {
    process.stdout.write("first query done\n");
  } else {
    for (let call = 0; call < MEMORY_CALLS; call += 1) {
      await library.cases.userById({ id: (call % USERS) + 1 });
    }
    globalThis.gc?.();
    const { rss, heapUsed } = process.memoryUsage();
    process.stdout.write(`${JSON.stringify({ rss, heapUsed })}\n`);
  }
} finally {
  await library.close();
}
