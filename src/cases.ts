import { DRAFT_EVERY, FIRST_PUBLISHED, postCount, TAG_DIGITS } from "./seed.ts";
import type { Scale } from "./seed.ts";

/** Arguments of each use case, as plain values every library accepts. */
export interface CaseArguments {
  /** Reads one user by primary key. */
  userById: { readonly id: number };
  /** Reads a page of published posts, newest first, by offset. */
  postsPage: { readonly page: number };
  /** Reads the published posts after a cursor, newest first, by keyset. */
  postsAfter: { readonly publishedAt: Date; readonly id: number };
  /** Reads a post with its comments: one to many. */
  postWithComments: { readonly id: number };
  /** Reads a page of published posts with the names of their tags: many to many. */
  postsWithTags: { readonly page: number };
  /** Reads the users with the most posts, with their counts. */
  topAuthors: { readonly limit: number };
  /** Reads 10,000 rows of numbers, timestamps, JSON and arrays. */
  wideEvents: { readonly afterId: number };
  /** Inserts a user and returns its id. */
  insertUser: { readonly email: string; readonly name: string };
  /** Inserts 1,000 comments in one statement. */
  insertComments: {
    readonly comments: readonly { postId: number; authorId: number; body: string }[];
  };
  /** Renames a post. */
  updatePostTitle: { readonly id: number; readonly title: string };
  /** Inserts a tag, or keeps the existing one of the same name, and returns its id. */
  upsertTag: { readonly name: string };
  /** Finds published posts that match a full-text search. */
  searchPosts: { readonly query: string };
}

export type CaseName = keyof CaseArguments;

/** What one library does for each use case, written the way its documentation recommends. */
export type Cases = {
  readonly [Name in CaseName]: (args: CaseArguments[Name]) => Promise<unknown>;
};

/** A library under benchmark, connected through a pool of `poolSize` node-postgres connections. */
export interface Library {
  readonly cases: Cases;
  readonly close: () => Promise<void>;
}

export type OpenLibrary = (url: string, poolSize: number) => Promise<Library> | Library;

/** Whether a use case writes, so it runs on a copy of the seeded database. */
export interface CaseDefinition<Name extends CaseName> {
  readonly name: Name;
  readonly writes: boolean;
  /** The arguments of the `index`-th call, the same for every library. */
  readonly argumentsFor: (index: number, scale: Scale) => CaseArguments[Name];
  /** Makes the `index`-th call on a library. */
  readonly call: (cases: Cases, index: number, scale: Scale) => Promise<unknown>;
}

const PAGE_PAGES = 50;
const WIDE_ROWS = 10_000;
const BULK_ROWS = 1000;
const SEARCH_WORDS = ["otter", "river", "kelp", "tide", "whisker"];
const MILLISECONDS_PER_MINUTE = 60_000;
const TOP_AUTHORS = 10;
// Twice as many names as seeded tags, so half the upserts insert and half update.
const UPSERT_NAMES_PER_TAG = 2;

/** A deterministic spread of `index` over `1..count`, so calls do not hit the same row. */
function spread(index: number, count: number): number {
  const PRIME = 7919;
  return ((index * PRIME) % count) + 1;
}

function define<Name extends CaseName>(
  name: Name,
  writes: boolean,
  argumentsFor: (index: number, scale: Scale) => CaseArguments[Name],
): CaseDefinition<Name> {
  return {
    name,
    writes,
    argumentsFor,
    call: async (cases, index, scale) => {
      const run: Cases[Name] = cases[name];
      return run(argumentsFor(index, scale));
    },
  };
}

export const caseDefinitions: readonly CaseDefinition<CaseName>[] = [
  define("userById", false, (index, scale) => ({ id: spread(index, scale.users) })),
  define("postsPage", false, (index) => ({ page: index % PAGE_PAGES })),
  // Every tenth post is a draft (seed.ts); the cursor is a published post, as the last row of a page is.
  define("postsAfter", false, (index, scale) => {
    const drawn = spread(index, postCount(scale));
    const id = drawn % DRAFT_EVERY === 0 ? drawn - 1 : drawn;
    return {
      publishedAt: new Date(Date.parse(FIRST_PUBLISHED) + id * MILLISECONDS_PER_MINUTE),
      id,
    };
  }),
  define("postWithComments", false, (index, scale) => ({ id: spread(index, postCount(scale)) })),
  define("postsWithTags", false, (index) => ({ page: index % PAGE_PAGES })),
  define("topAuthors", false, () => ({ limit: TOP_AUTHORS })),
  define("wideEvents", false, (index, scale) => ({
    afterId: index % Math.max(1, scale.events - WIDE_ROWS),
  })),
  define("insertUser", true, (index) => ({
    email: `new${String(index)}@example.com`,
    name: `New ${String(index)}`,
  })),
  define("insertComments", true, (index, scale) => ({
    comments: Array.from({ length: BULK_ROWS }, (_value, row) => ({
      postId: spread(index * BULK_ROWS + row, postCount(scale)),
      authorId: spread(index + row, scale.users),
      body: `Bulk ${String(index)}.${String(row)}`,
    })),
  })),
  define("updatePostTitle", true, (index, scale) => ({
    id: spread(index, postCount(scale)),
    title: `Renamed ${String(index)}`,
  })),
  define("upsertTag", true, (index, scale) => ({
    name: `tag-${String(index % (scale.tags * UPSERT_NAMES_PER_TAG)).padStart(TAG_DIGITS, "0")}`,
  })),
  define("searchPosts", false, (index) => ({
    query: SEARCH_WORDS[index % SEARCH_WORDS.length] ?? "otter",
  })),
];

/** Rows per page of the paginated use cases (the `limit 20` of queries.sql). */
export const PAGE_SIZE = 20;
/** Rows the wide use case reads. */
export const WIDE_LIMIT = WIDE_ROWS;
