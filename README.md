# ottersql benchmarks

Benchmarks that compare [ottersql](https://github.com/otterfamily/ottersql) with other TypeScript database libraries on the same Postgres, written so that anyone can check and rerun them.

## What is measured

Each use case is written the way each library's documentation recommends, on the same schema ([`db/schema.sql`](db/schema.sql)) and the same deterministic data ([`src/seed.ts`](src/seed.ts), about a million rows):

| Use case           | What it does                                         |
| ------------------ | ---------------------------------------------------- |
| `userById`         | One row by primary key                               |
| `postsPage`        | A page of 20 published posts, by offset              |
| `postsAfter`       | The 20 published posts after a cursor, by keyset     |
| `postWithComments` | A post with its comments (one to many)               |
| `postsWithTags`    | A page of posts with their tag names (many to many)  |
| `topAuthors`       | Users with the most posts (aggregate)                |
| `wideEvents`       | 10,000 rows of timestamps, numerics, JSON and arrays |
| `insertUser`       | One insert returning the id                          |
| `insertComments`   | 1,000 rows in one statement                          |
| `updatePostTitle`  | One update by primary key                            |
| `upsertTag`        | Insert or keep a tag by its unique name              |
| `searchPosts`      | Full-text search                                     |

Libraries: node-postgres (the baseline), ottersql, Drizzle, Kysely and Prisma 7, all on node-postgres with a pool of 10 connections. postgres.js and Bun.sql change the driver too, so they will be compared separately.

## Rules

These answer the fairness problems raised against earlier ORM benchmarks.

1. Versions are pinned in `pnpm-workspace.yaml` and every result records them, with the machine, Node and Postgres.
2. Every library uses the same driver (node-postgres), pool size and statement mode (unnamed statements, each library's default).
3. Every library returns the same results: `pnpm test` runs each use case on each library and compares the results, normalised only for representation (`Date` or Temporal, `bigint` or string).
4. Postgres runs with `pg_stat_statements`, and every result lists the statements each library sent and how many per call, so differences in SQL are visible rather than hidden.
5. Use cases that write run on a fresh copy of the seeded database, so earlier writes cannot change later timings.
6. Each measurement warms up for a second, then calls the use case one call at a time for a fixed time. The run repeats five times, rotating the order of libraries, and reports the median of the run medians with their spread, the p99 and the calls per second.
7. The raw results are kept as JSON next to the table. Results where a library loses are published like the others.

### Known limits

- Calls are made one at a time, which measures each library's own cost per call. Throughput under concurrent, open-model load comes next.
- The libraries and Postgres share one machine. Published results will say so until they run on separate machines.
- ottersql has no relation API yet, so its `postWithComments` sends two queries.
- Prisma is at 7.9.1, the newest release whose CLI has npm provenance; 7.10 does not.

## Running

Install pnpm 11 or later; it fetches the pinned pnpm and Node.js. Docker must be running.

```sh
pnpm install
pnpm test                          # every library returns the same results
pnpm bench                         # about 20 minutes; writes results/raw/<time>.json
pnpm bench --scale tiny --runs 1 --seconds 1   # a quick try
pnpm bench --help
```

## License

[Apache-2.0](LICENSE)
