import { Kysely, PostgresDialect, sql } from "kysely";
import type { Generated } from "kysely";
import { jsonArrayFrom } from "kysely/helpers/postgres";
import { Pool } from "pg";

import { PAGE_SIZE, WIDE_LIMIT } from "../cases.ts";
import type { Library } from "../cases.ts";

// The tables of db/schema.sql as kysely-codegen writes them for node-postgres's default parsers.
interface Database {
  users: {
    id: Generated<string>;
    email: string;
    name: string;
    created_at: Generated<Date>;
  };
  posts: {
    id: Generated<string>;
    author_id: string;
    title: string;
    body: string;
    published_at: Date | null;
    created_at: Generated<Date>;
  };
  comments: {
    id: Generated<string>;
    post_id: string | number;
    author_id: string | number;
    body: string;
    created_at: Generated<Date>;
  };
  tags: { id: Generated<string>; name: string };
  post_tags: { post_id: string; tag_id: string };
  events: {
    id: Generated<string>;
    user_id: string | null;
    kind: string;
    amount: string | null;
    payload: unknown;
    labels: string[];
    happened_at: Date;
    succeeded: boolean;
  };
}

/** Kysely over node-postgres, nesting related rows with its Postgres JSON helpers. */
export function openKysely(url: string, poolSize: number): Library {
  const pool = new Pool({ connectionString: url, max: poolSize });
  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
  const publishedPosts = db
    .selectFrom("posts")
    .where("published_at", "is not", null)
    .orderBy("published_at", "desc")
    .orderBy("id", "desc");
  return {
    cases: {
      userById: async ({ id }) =>
        (await db
          .selectFrom("users")
          .select(["id", "email", "name", "created_at"])
          .where("id", "=", String(id))
          .executeTakeFirst()) ?? null,
      postsPage: async ({ page }) =>
        publishedPosts
          .select(["id", "author_id", "title", "published_at"])
          .limit(PAGE_SIZE)
          .offset(page * PAGE_SIZE)
          .execute(),
      postsAfter: async ({ publishedAt, id }) =>
        publishedPosts
          .select(["id", "author_id", "title", "published_at"])
          .where((eb) =>
            eb(eb.refTuple("published_at", "id"), "<", eb.tuple(publishedAt, String(id))),
          )
          .limit(PAGE_SIZE)
          .execute(),
      postWithComments: async ({ id }) =>
        (await db
          .selectFrom("posts")
          .select((eb) => [
            "posts.id",
            "posts.title",
            "posts.body",
            jsonArrayFrom(
              eb
                .selectFrom("comments")
                .select([
                  "comments.id",
                  "comments.author_id",
                  "comments.body",
                  "comments.created_at",
                ])
                .whereRef("comments.post_id", "=", "posts.id")
                .orderBy("comments.id"),
            ).as("comments"),
          ])
          .where("posts.id", "=", String(id))
          .executeTakeFirst()) ?? null,
      postsWithTags: async ({ page }) => {
        const rows = await publishedPosts
          .select((eb) => [
            "posts.id",
            "posts.title",
            jsonArrayFrom(
              eb
                .selectFrom("post_tags")
                .innerJoin("tags", "tags.id", "post_tags.tag_id")
                .select("tags.name")
                .whereRef("post_tags.post_id", "=", "posts.id")
                .orderBy("tags.name"),
            ).as("tags"),
          ])
          .limit(PAGE_SIZE)
          .offset(page * PAGE_SIZE)
          .execute();
        return rows.map((post) => ({
          id: post.id,
          title: post.title,
          tags: post.tags.map((tag) => tag.name),
        }));
      },
      topAuthors: async ({ limit }) =>
        db
          .selectFrom("users")
          .innerJoin("posts", "posts.author_id", "users.id")
          .select((eb) => ["users.id", "users.name", eb.fn.count("posts.id").as("posts")])
          .groupBy("users.id")
          .orderBy("posts", "desc")
          .orderBy("users.id")
          .limit(limit)
          .execute(),
      wideEvents: async ({ afterId }) =>
        db
          .selectFrom("events")
          .selectAll()
          .where("id", ">", String(afterId))
          .orderBy("id")
          .limit(WIDE_LIMIT)
          .execute(),
      insertUser: async ({ email, name }) =>
        db.insertInto("users").values({ email, name }).returning("id").executeTakeFirstOrThrow(),
      insertComments: async ({ comments }) => {
        await db
          .insertInto("comments")
          .values(
            comments.map((comment) => ({
              post_id: comment.postId,
              author_id: comment.authorId,
              body: comment.body,
            })),
          )
          .execute();
      },
      updatePostTitle: async ({ id, title }) => {
        await db.updateTable("posts").set({ title }).where("id", "=", String(id)).execute();
      },
      upsertTag: async ({ name }) =>
        db
          .insertInto("tags")
          .values({ name })
          .onConflict((conflict) =>
            conflict.column("name").doUpdateSet((eb) => ({ name: eb.ref("excluded.name") })),
          )
          .returning("id")
          .executeTakeFirstOrThrow(),
      searchPosts: async ({ query }) =>
        db
          .selectFrom("posts")
          .select(["id", "title"])
          .where("published_at", "is not", null)
          .where(
            sql<boolean>`to_tsvector('english', title || ' ' || body) @@ plainto_tsquery('english', ${query})`,
          )
          .orderBy("id")
          .limit(PAGE_SIZE)
          .execute(),
    },
    close: async () => db.destroy(),
  };
}
