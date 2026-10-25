import { and, asc, count, desc, eq, gt, isNotNull, lt, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { PAGE_SIZE, WIDE_LIMIT } from "../cases.ts";
import type { Library } from "../cases.ts";
import * as schema from "./schema.ts";

const { comments, events, posts, tags, users } = schema;

/** Drizzle with its select builder, and its relational queries for posts with comments or tags. */
export function openDrizzle(url: string, poolSize: number): Library {
  const pool = new Pool({ connectionString: url, max: poolSize });
  const db = drizzle({ client: pool, schema });
  const published = isNotNull(posts.publishedAt);
  return {
    cases: {
      userById: async ({ id }) => {
        const rows = await db
          .select({
            id: users.id,
            email: users.email,
            name: users.name,
            createdAt: users.createdAt,
          })
          .from(users)
          .where(eq(users.id, id));
        return rows[0] ?? null;
      },
      postsPage: async ({ page }) =>
        db
          .select({
            id: posts.id,
            authorId: posts.authorId,
            title: posts.title,
            publishedAt: posts.publishedAt,
          })
          .from(posts)
          .where(published)
          .orderBy(desc(posts.publishedAt), desc(posts.id))
          .limit(PAGE_SIZE)
          .offset(page * PAGE_SIZE),
      // Drizzle's cursor pagination guide compares a pair of columns with or/and.
      postsAfter: async ({ publishedAt, id }) =>
        db
          .select({
            id: posts.id,
            authorId: posts.authorId,
            title: posts.title,
            publishedAt: posts.publishedAt,
          })
          .from(posts)
          .where(
            and(
              published,
              or(
                lt(posts.publishedAt, publishedAt),
                and(eq(posts.publishedAt, publishedAt), lt(posts.id, id)),
              ),
            ),
          )
          .orderBy(desc(posts.publishedAt), desc(posts.id))
          .limit(PAGE_SIZE),
      postWithComments: async ({ id }) =>
        (await db.query.posts.findFirst({
          where: eq(posts.id, id),
          columns: { id: true, title: true, body: true },
          with: {
            comments: {
              columns: { id: true, authorId: true, body: true, createdAt: true },
              orderBy: asc(comments.id),
            },
          },
        })) ?? null,
      postsWithTags: async ({ page }) => {
        const rows = await db.query.posts.findMany({
          where: published,
          orderBy: [desc(posts.publishedAt), desc(posts.id)],
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
          columns: { id: true, title: true },
          with: { postTags: { with: { tag: { columns: { name: true } } } } },
        });
        return rows.map((post) => ({
          id: post.id,
          title: post.title,
          tags: post.postTags.map((postTag) => postTag.tag.name).toSorted(),
        }));
      },
      topAuthors: async ({ limit }) =>
        db
          .select({ id: users.id, name: users.name, posts: count(posts.id) })
          .from(users)
          .innerJoin(posts, eq(posts.authorId, users.id))
          .groupBy(users.id)
          .orderBy(desc(count(posts.id)), users.id)
          .limit(limit),
      wideEvents: async ({ afterId }) =>
        db.select().from(events).where(gt(events.id, afterId)).orderBy(events.id).limit(WIDE_LIMIT),
      insertUser: async ({ email, name }) => {
        const rows = await db.insert(users).values({ email, name }).returning({ id: users.id });
        return rows[0];
      },
      insertComments: async (args) => {
        await db.insert(comments).values([...args.comments]);
      },
      updatePostTitle: async ({ id, title }) => {
        await db.update(posts).set({ title }).where(eq(posts.id, id));
      },
      upsertTag: async ({ name }) => {
        const rows = await db
          .insert(tags)
          .values({ name })
          .onConflictDoUpdate({ target: tags.name, set: { name: sql`excluded.name` } })
          .returning({ id: tags.id });
        return rows[0];
      },
      searchPosts: async ({ query }) =>
        db
          .select({ id: posts.id, title: posts.title })
          .from(posts)
          .where(
            and(
              published,
              sql`to_tsvector('english', ${posts.title} || ' ' || ${posts.body}) @@ plainto_tsquery('english', ${query})`,
            ),
          )
          .orderBy(posts.id)
          .limit(PAGE_SIZE),
    },
    close: async () => pool.end(),
  };
}
