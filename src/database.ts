import { readFile } from "node:fs/promises";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";

import { seedSql } from "./seed.ts";
import type { Scale } from "./seed.ts";

/** Pinned to a minor version, so a Postgres release cannot change results unannounced. */
export const POSTGRES_IMAGE = "postgres:18.6-alpine";

const SEEDED = "seeded";

/** A Postgres server with the seeded database as a template, so every run starts from the same data. */
export interface Server {
  /** Creates a database named `name` from the seeded one and returns its URL. */
  readonly copy: (name: string) => Promise<string>;
  /** Drops a database `copy` created. */
  readonly drop: (url: string) => Promise<void>;
  readonly stop: () => Promise<void>;
}

async function withClient<Result>(
  url: string,
  use: (client: Client) => Promise<Result>,
): Promise<Result> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await use(client);
  } finally {
    await client.end();
  }
}

function databaseUrl(adminUrl: string, name: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

/** Starts Postgres with pg_stat_statements loaded and seeds the template database at `scale`. */
export async function startServer(scale: Scale): Promise<Server> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withCommand(["postgres", "-c", "shared_preload_libraries=pg_stat_statements"])
    .start();
  const adminUrl = container.getConnectionUri();
  const schema = await readFile(new URL("../db/schema.sql", import.meta.url), "utf8");
  await withClient(adminUrl, async (client) => client.query(`create database ${SEEDED}`));
  await withClient(databaseUrl(adminUrl, SEEDED), async (client) => {
    await client.query(schema);
    await client.query(seedSql(scale));
  });
  return {
    copy: async (name) => {
      await withClient(adminUrl, async (client) => {
        await client.query(`create database ${name} template ${SEEDED}`);
      });
      const url = databaseUrl(adminUrl, name);
      await withClient(url, async (client) => client.query("create extension pg_stat_statements"));
      return url;
    },
    drop: async (url) => {
      const name = new URL(url).pathname.slice(1);
      await withClient(adminUrl, async (client) =>
        client.query(`drop database ${name} with (force)`),
      );
    },
    stop: async () => {
      await container.stop();
    },
  };
}

/** A statement Postgres ran, with its constants replaced by `$n`, and how many times. */
export interface Statement {
  readonly query: string;
  readonly calls: number;
}

/** Forgets the statements recorded so far, on every database of the server. */
export async function resetStatements(url: string): Promise<void> {
  await withClient(url, async (client) => client.query("select pg_stat_statements_reset()"));
}

/** The statements run on the database at `url` since the last reset, most called first. */
export async function readStatements(url: string): Promise<Statement[]> {
  return withClient(url, async (client) => {
    const result = await client.query<{ query: string; calls: string }>(
      `select query, calls from pg_stat_statements
        where dbid = (select oid from pg_database where datname = current_database())
          and query not like '%pg_stat_statements%'
        order by calls desc, query`,
    );
    return result.rows.map((row) => ({ query: row.query, calls: Number(row.calls) }));
  });
}
