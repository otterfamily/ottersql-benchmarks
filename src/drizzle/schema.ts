import { relations } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// Mirrors db/schema.sql, which creates the tables; Drizzle only reads and writes them.

const id = () => bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity();
const reference = (name: string) => bigint(name, { mode: "number" });
const instant = (name: string) => timestamp(name, { withTimezone: true });

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  createdAt: instant("created_at").notNull().defaultNow(),
});

export const posts = pgTable(
  "posts",
  {
    id: id(),
    authorId: reference("author_id")
      .notNull()
      .references(() => users.id),
    title: text("title").notNull(),
    body: text("body").notNull(),
    publishedAt: instant("published_at"),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (table) => [index("posts_author_id").on(table.authorId)],
);

export const comments = pgTable("comments", {
  id: id(),
  postId: reference("post_id")
    .notNull()
    .references(() => posts.id),
  authorId: reference("author_id")
    .notNull()
    .references(() => users.id),
  body: text("body").notNull(),
  createdAt: instant("created_at").notNull().defaultNow(),
});

export const tags = pgTable("tags", {
  id: id(),
  name: text("name").notNull().unique(),
});

export const postTags = pgTable(
  "post_tags",
  {
    postId: reference("post_id")
      .notNull()
      .references(() => posts.id),
    tagId: reference("tag_id")
      .notNull()
      .references(() => tags.id),
  },
  (table) => [primaryKey({ columns: [table.postId, table.tagId] })],
);

export const events = pgTable("events", {
  id: id(),
  userId: reference("user_id").references(() => users.id),
  kind: text("kind").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }),
  payload: jsonb("payload").notNull(),
  labels: text("labels").array().notNull(),
  happenedAt: instant("happened_at").notNull(),
  succeeded: boolean("succeeded").notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({ posts: many(posts) }));

export const postsRelations = relations(posts, ({ one, many }) => ({
  author: one(users, { fields: [posts.authorId], references: [users.id] }),
  comments: many(comments),
  postTags: many(postTags),
}));

export const commentsRelations = relations(comments, ({ one }) => ({
  post: one(posts, { fields: [comments.postId], references: [posts.id] }),
}));

export const postTagsRelations = relations(postTags, ({ one }) => ({
  post: one(posts, { fields: [postTags.postId], references: [posts.id] }),
  tag: one(tags, { fields: [postTags.tagId], references: [tags.id] }),
}));
