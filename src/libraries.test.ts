import { deepStrictEqual, ok } from "node:assert/strict";
import { test } from "node:test";

import { Client } from "pg";

import { caseDefinitions } from "./cases.ts";
import type { CaseDefinition, CaseName, Library } from "./cases.ts";
import { startServer } from "./database.ts";
import type { Server } from "./database.ts";
import { libraries } from "./libraries.ts";
import { normalize } from "./normalize.ts";
import { tiny } from "./seed.ts";

const CALLS = 3;
const POOL_SIZE = 2;
const [baseline = "pg", ...others] = Object.keys(libraries);

/** What use cases that return nothing leave behind, read back to compare their effects instead. */
const effects: Partial<Record<CaseName, string>> = {
  insertComments: "select post_id, author_id, body from comments order by id",
  updatePostTitle: "select id, title from posts order by id",
};

async function effectOn(url: string, sql: string): Promise<unknown> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const result = await client.query(sql);
    return normalize(result.rows);
  } finally {
    await client.end();
  }
}

async function open(library: string, url: string): Promise<Library> {
  const opener = libraries[library];
  if (opener === undefined) {
    throw new Error(`no library ${library}`);
  }
  return opener(url, POOL_SIZE);
}

/** The normalized results of the first calls of a use case, on a fresh copy of the seeded data. */
async function resultsOf(
  server: Server,
  library: string,
  definition: CaseDefinition<CaseName>,
): Promise<unknown[]> {
  const url = await server.copy(`${definition.name.toLowerCase()}_${library}`);
  const opened = await open(library, url);
  try {
    const results: unknown[] = [];
    for (let index = 0; index < CALLS; index += 1) {
      results.push(normalize(await definition.call(opened.cases, index, tiny)));
    }
    const effect = effects[definition.name];
    return effect === undefined ? results : [...results, await effectOn(url, effect)];
  } finally {
    await opened.close();
    await server.drop(url);
  }
}

const server = await startServer(tiny);
try {
  for (const definition of caseDefinitions) {
    await test(definition.name, async (context) => {
      const expected = await resultsOf(server, baseline, definition);
      ok(expected.some((result) => result !== null));
      for (const library of others) {
        await context.test(`${library} returns what ${baseline} returns`, async () => {
          deepStrictEqual(await resultsOf(server, library, definition), expected);
        });
      }
    });
  }
} finally {
  await server.stop();
}
