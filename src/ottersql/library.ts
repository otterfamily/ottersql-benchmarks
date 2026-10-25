import { pgConnection } from "@ottersql/sql/pg";
import { Pool } from "pg";

import { PAGE_SIZE } from "../cases.ts";
import type { Library } from "../cases.ts";
import {
  commentsOfPost,
  insertComments,
  insertUser,
  postById,
  postsAfter,
  postsPage,
  postsWithTags,
  searchPosts,
  topAuthors,
  updatePostTitle,
  upsertTag,
  userById,
  wideEvents,
} from "./queries.sql";

/**
 * The typed `.sql` queries of ottersql over node-postgres. ottersql has no relation API yet (M2),
 * so a post and its comments take two queries.
 */
export function openOttersql(url: string, poolSize: number): Library {
  const pool = new Pool({ connectionString: url, max: poolSize });
  const db = pgConnection(pool);
  return {
    cases: {
      userById: async ({ id }) => userById.maybeOne(db, { id }),
      postsPage: async ({ page }) => postsPage(db, { offset: page * PAGE_SIZE }),
      postsAfter: async ({ publishedAt, id }) =>
        postsAfter(db, {
          publishedAt: Temporal.Instant.fromEpochMilliseconds(publishedAt.getTime()),
          id,
        }),
      postWithComments: async ({ id }) => {
        const [post, comments] = await Promise.all([
          postById.maybeOne(db, { id }),
          commentsOfPost(db, { postId: id }),
        ]);
        return post === null ? null : { ...post, comments };
      },
      postsWithTags: async ({ page }) => postsWithTags(db, { offset: page * PAGE_SIZE }),
      topAuthors: async ({ limit }) => topAuthors(db, { limit }),
      wideEvents: async ({ afterId }) => wideEvents(db, { afterId }),
      insertUser: async ({ email, name }) => insertUser.one(db, { email, name }),
      insertComments: async ({ comments }) => {
        await insertComments(db, {
          postIds: comments.map((comment) => comment.postId),
          authorIds: comments.map((comment) => comment.authorId),
          bodies: comments.map((comment) => comment.body),
        });
      },
      updatePostTitle: async ({ id, title }) => {
        await updatePostTitle(db, { id, title });
      },
      upsertTag: async ({ name }) => upsertTag.one(db, { name }),
      searchPosts: async ({ query }) => searchPosts(db, { query }),
    },
    close: async () => pool.end(),
  };
}
