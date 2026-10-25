import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gzip } from "node:zlib";

import { readQueryFile } from "@ottersql/sql/tooling";
import { build } from "esbuild";
import type { Plugin } from "esbuild";

/**
 * The application each library's bundle starts from: the use cases of the runtime benchmark, and,
 * as the baseline, node-postgres alone.
 */
export const bundleEntries: Readonly<Record<string, string>> = {
  pg: "pg",
  ottersql: "../ottersql/library.ts",
  drizzle: "../drizzle/library.ts",
  kysely: "../kysely/library.ts",
  prisma: "../prisma/library.ts",
};

/** The size of a minified bundle, as written and gzipped, in bytes. */
export interface BundleSize {
  readonly bytes: number;
  readonly gzipBytes: number;
}

const sqlFile = /\.sql$/;
const compress = promisify(gzip);

/**
 * Loads `.sql` files as the modules `@ottersql/sql/register` makes of them: a `defineQuery` per
 * query. ottersql 0.1.1 has no esbuild plugin, so the benchmark builds the same module itself.
 */
const sqlModules: Plugin = {
  name: "ottersql-sql",
  setup: (builder) => {
    builder.onLoad({ filter: sqlFile }, async ({ path }) => {
      const file = readQueryFile(await readFile(path, "utf8"));
      const exports = file.queries.map(
        (query) =>
          `export const ${query.name} = defineQuery(${JSON.stringify(query.sql)}, ${JSON.stringify(query.parameters.map(({ name }) => name))});`,
      );
      return {
        contents: ['import { defineQuery } from "@ottersql/sql";', ...exports].join("\n"),
        loader: "js",
      };
    });
  },
};

function entryFile(entry: string): { readonly contents: string } | { readonly path: string } {
  return entry.startsWith(".")
    ? { path: fileURLToPath(new URL(entry, import.meta.url)) }
    : { contents: `export * from ${JSON.stringify(entry)};` };
}

/** Bundles `entry` for Node, minified, with every dependency inside but pg's optional native addon. */
export async function bundleSize(entry: string): Promise<BundleSize> {
  const file = entryFile(entry);
  const result = await build({
    ...("path" in file
      ? { entryPoints: [file.path] }
      : {
          stdin: {
            contents: file.contents,
            resolveDir: import.meta.dirname,
          },
        }),
    bundle: true,
    platform: "node",
    format: "esm",
    minify: true,
    write: false,
    logLevel: "silent",
    external: ["pg-native"],
    plugins: [sqlModules],
  });
  const output = result.outputFiles.map((out) => out.contents);
  const bytes = output.reduce((sum, contents) => sum + contents.byteLength, 0);
  const zipped = await Promise.all(output.map(async (contents) => compress(contents)));
  const gzipBytes = zipped.reduce((sum, contents) => sum + contents.byteLength, 0);
  return { bytes, gzipBytes };
}
