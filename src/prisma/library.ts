import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

import { PAGE_SIZE, WIDE_LIMIT } from "../cases.ts";
import type { Library } from "../cases.ts";
import { PrismaClient } from "./generated/client.ts";

const published = { publishedAt: { not: null } };
const newestFirst = [{ publishedAt: "desc" as const }, { id: "desc" as const }];
const postSummary = { id: true, authorId: true, title: true, publishedAt: true };

/** Prisma 7 with its node-postgres adapter, and raw SQL where its query API has no full-text search. */
export function openPrisma(url: string, poolSize: number): Library {
  const pool = new Pool({ connectionString: url, max: poolSize });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  return {
    cases: {
      userById: async ({ id }) =>
        prisma.user.findUnique({
          where: { id: BigInt(id) },
          select: { id: true, email: true, name: true, createdAt: true },
        }),
      postsPage: async ({ page }) =>
        prisma.post.findMany({
          where: published,
          orderBy: newestFirst,
          skip: page * PAGE_SIZE,
          take: PAGE_SIZE,
          select: postSummary,
        }),
      // Prisma's cursor pagination takes the last row's unique id and skips that row.
      postsAfter: async ({ id }) =>
        prisma.post.findMany({
          where: published,
          orderBy: newestFirst,
          cursor: { id: BigInt(id) },
          skip: 1,
          take: PAGE_SIZE,
          select: postSummary,
        }),
      postWithComments: async ({ id }) =>
        prisma.post.findUnique({
          where: { id: BigInt(id) },
          select: {
            id: true,
            title: true,
            body: true,
            comments: {
              select: { id: true, authorId: true, body: true, createdAt: true },
              orderBy: { id: "asc" },
            },
          },
        }),
      postsWithTags: async ({ page }) => {
        const rows = await prisma.post.findMany({
          where: published,
          orderBy: newestFirst,
          skip: page * PAGE_SIZE,
          take: PAGE_SIZE,
          select: {
            id: true,
            title: true,
            postTags: { select: { tag: { select: { name: true } } } },
          },
        });
        return rows.map((post) => ({
          id: post.id,
          title: post.title,
          tags: post.postTags.map((postTag) => postTag.tag.name).toSorted(),
        }));
      },
      topAuthors: async ({ limit }) => {
        const rows = await prisma.user.findMany({
          select: { id: true, name: true, _count: { select: { posts: true } } },
          orderBy: [{ posts: { _count: "desc" } }, { id: "asc" }],
          take: limit,
        });
        return rows.map((user) => ({ id: user.id, name: user.name, posts: user._count.posts }));
      },
      wideEvents: async ({ afterId }) =>
        prisma.event.findMany({
          where: { id: { gt: BigInt(afterId) } },
          orderBy: { id: "asc" },
          take: WIDE_LIMIT,
        }),
      insertUser: async ({ email, name }) =>
        prisma.user.create({ data: { email, name }, select: { id: true } }),
      insertComments: async ({ comments }) => {
        await prisma.comment.createMany({
          data: comments.map((comment) => ({
            postId: BigInt(comment.postId),
            authorId: BigInt(comment.authorId),
            body: comment.body,
          })),
        });
      },
      updatePostTitle: async ({ id, title }) => {
        await prisma.post.update({ where: { id: BigInt(id) }, data: { title } });
      },
      upsertTag: async ({ name }) =>
        prisma.tag.upsert({ where: { name }, create: { name }, update: {}, select: { id: true } }),
      searchPosts: async ({ query }) =>
        prisma.$queryRaw`select id, title from posts
          where published_at is not null
            and to_tsvector('english', title || ' ' || body) @@ plainto_tsquery('english', ${query})
          order by id limit ${PAGE_SIZE}`,
    },
    close: async () => {
      await prisma.$disconnect();
      await pool.end();
    },
  };
}
