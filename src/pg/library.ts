import { readFile } from "node:fs/promises";

import { readQueryFile } from "@ottersql/sql/tooling";
import { Pool } from "pg";

import { PAGE_SIZE } from "../cases.ts";
import type { Library } from "../cases.ts";

type Run = (name: string, params: Readonly<Record<string, unknown>>) => Promise<unknown[]>;

/**
 * The baseline: node-postgres with its own parsers. It sends exactly the SQL of ottersql's query
 * file, so the difference between the two is what ottersql adds on top of the driver.
 */
export async function openPg(url: string, poolSize: number): Promise<Library> {
  const pool = new Pool({ connectionString: url, max: poolSize });
  const file = readQueryFile(
    await readFile(new URL("../ottersql/queries.sql", import.meta.url), "utf8"),
  );
  const queries = new Map(file.queries.map((query) => [query.name, query]));
  const run: Run = async (name, params) => {
    const query = queries.get(name);
    if (query === undefined) {
      throw new Error(`queries.sql has no query ${name}`);
    }
    const values = query.parameters.map((parameter) => params[parameter.name]);
    const result = await pool.query<Readonly<Record<string, unknown>>>(query.sql, values);
    return result.rows;
  };
  const first = async (name: string, params: Readonly<Record<string, unknown>>) => {
    const rows = await run(name, params);
    return rows[0] ?? null;
  };
  return {
    cases: {
      userById: async ({ id }) => first("userById", { id }),
      postsPage: async ({ page }) => run("postsPage", { offset: page * PAGE_SIZE }),
      postsAfter: async ({ publishedAt, id }) => run("postsAfter", { publishedAt, id }),
      postWithComments: async ({ id }) => {
        const [post, comments] = await Promise.all([
          first("postById", { id }),
          run("commentsOfPost", { postId: id }),
        ]);
        return post === null ? null : { ...post, comments };
      },
      postsWithTags: async ({ page }) => run("postsWithTags", { offset: page * PAGE_SIZE }),
      topAuthors: async ({ limit }) => run("topAuthors", { limit }),
      wideEvents: async ({ afterId }) => run("wideEvents", { afterId }),
      insertUser: async ({ email, name }) => first("insertUser", { email, name }),
      insertComments: async ({ comments }) => {
        await run("insertComments", {
          postIds: comments.map((comment) => comment.postId),
          authorIds: comments.map((comment) => comment.authorId),
          bodies: comments.map((comment) => comment.body),
        });
      },
      updatePostTitle: async ({ id, title }) => {
        await run("updatePostTitle", { id, title });
      },
      upsertTag: async ({ name }) => first("upsertTag", { name }),
      searchPosts: async ({ query }) => run("searchPosts", { query }),
    },
    close: async () => pool.end(),
  };
}
