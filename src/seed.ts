/** How many rows each table gets. Every other count follows from the number of users. */
export interface Scale {
  readonly users: number;
  readonly postsPerUser: number;
  readonly commentsPerPost: number;
  readonly tags: number;
  readonly tagsPerPost: number;
  readonly events: number;
}

/** About a million rows: a small production database, large enough that indexes matter. */
export const realistic: Scale = {
  users: 10_000,
  postsPerUser: 10,
  commentsPerPost: 5,
  tags: 100,
  tagsPerPost: 3,
  events: 100_000,
};

/** Enough rows for every query to return something, for tests that compare results. */
export const tiny: Scale = {
  users: 20,
  postsPerUser: 5,
  commentsPerPost: 3,
  tags: 10,
  tagsPerPost: 3,
  events: 50,
};

/** The number of posts a scale creates, the range post ids are drawn from. */
export function postCount(scale: Scale): number {
  return scale.users * scale.postsPerUser;
}

/** Every post whose id is a multiple of this is a draft. */
export const DRAFT_EVERY = 10;

/** Post n is published n minutes after this, unless it is a draft. */
export const FIRST_PUBLISHED = "2025-06-01T00:00:00Z";

/** Digits of the number in a tag's name, `tag-001`. */
export const TAG_DIGITS = 3;

const WORDS = "otter river stone shell kelp tide raft whisker paw float dive sleep";

/**
 * SQL that fills the empty schema. It derives every value from row numbers, so each run and each
 * library sees the same data, and runs in Postgres, so a million rows take seconds.
 */
export function seedSql(scale: Scale): string {
  const posts = postCount(scale);
  return `
    insert into users (email, name, created_at)
      select 'user' || n || '@example.com', 'User ' || n,
        timestamptz '2025-01-01' + n * interval '1 minute'
      from generate_series(1, ${String(scale.users)}) as n;

    insert into posts (author_id, title, body, published_at, created_at)
      select (n - 1) % ${String(scale.users)} + 1,
        'Post ' || n || ' about ' || (string_to_array('${WORDS}', ' '))[n % 12 + 1],
        repeat('${WORDS} ', 5) || n,
        case when n % ${String(DRAFT_EVERY)} = 0 then null
          else timestamptz '${FIRST_PUBLISHED}' + n * interval '1 minute' end,
        timestamptz '${FIRST_PUBLISHED}' + n * interval '1 minute'
      from generate_series(1, ${String(posts)}) as n;

    insert into comments (post_id, author_id, body, created_at)
      select (n - 1) % ${String(posts)} + 1, (n * 7 - 1) % ${String(scale.users)} + 1,
        'Comment ' || n, timestamptz '2025-07-01' + n * interval '1 second'
      from generate_series(1, ${String(posts * scale.commentsPerPost)}) as n;

    insert into tags (name)
      select 'tag-' || lpad(n::text, ${String(TAG_DIGITS)}, '0') from generate_series(1, ${String(scale.tags)}) as n;

    insert into post_tags (post_id, tag_id)
      select p, (p * 3 + k * 7) % ${String(scale.tags)} + 1
      from generate_series(1, ${String(posts)}) as p,
        generate_series(0, ${String(scale.tagsPerPost - 1)}) as k
      on conflict do nothing;

    insert into events (user_id, kind, amount, payload, labels, happened_at, succeeded)
      select case when n % 5 = 0 then null else (n - 1) % ${String(scale.users)} + 1 end,
        (array['view', 'click', 'purchase'])[n % 3 + 1],
        case when n % 3 = 2 then (n % 10000) / 100.0 end,
        jsonb_build_object('n', n, 'path', '/posts/' || n, 'ok', n % 2 = 0),
        array['web', 'beta', 'v' || n % 4],
        timestamptz '2025-08-01' + n * interval '1 second',
        n % 7 <> 0
      from generate_series(1, ${String(scale.events)}) as n;

    analyze;
  `;
}
