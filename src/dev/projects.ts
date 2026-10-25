// Writes, for each library, a project with a schema of `tables` tables and three queries per table
// (one row by id, a filtered list, an insert returning the id), each written the way the
// library's documentation shows, so that type checking them compares like with like.

/** The libraries whose development cost is compared. */
export const devLibraries = ["ottersql", "drizzle", "kysely", "prisma"] as const;

export type DevLibrary = (typeof devLibraries)[number];

/** A project's files by relative path. */
export type Files = Readonly<Record<string, string>>;

const compilerOptions = {
  target: "es2025",
  module: "nodenext",
  lib: ["es2025", "esnext.temporal"],
  types: ["node"],
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  allowImportingTsExtensions: true,
};

const JSON_INDENT = 2;

function json(value: unknown): string {
  return `${JSON.stringify(value, null, JSON_INDENT)}\n`;
}

function tableIndexes(tables: number): number[] {
  return Array.from({ length: tables }, (_value, index) => index);
}

/** Each table but the first references the one before it, so the schema has foreign keys. */
function tableSql(index: number): string {
  const parent = index === 0 ? "" : `,\n  parent_id int8 references t${String(index - 1)} (id)`;
  return `create table t${String(index)} (
  id int8 generated always as identity primary key,
  name text not null,
  status text not null default 'new',
  amount numeric(12, 2),
  created_at timestamptz not null default now()${parent}
);
`;
}

/** Calls the three queries of a table and uses their results, so their types are checked. */
function usage(index: number, body: string, parameter: string): string {
  return `export async function useT${String(index)}(${parameter}): Promise<string> {
${body}
  return \`\${row?.name ?? ""}\${String(list.length)}\${String(created?.id)}\`;
}
`;
}

function ottersqlQueries(index: number): string {
  const table = `t${String(index)}`;
  return `-- @name byId
select id, name, status, amount, created_at from ${table} where id = :id;

-- @name list
select id, name from ${table} where status = :status order by created_at desc limit 20;

-- @name insert
insert into ${table} (name, status) values (:name, :status) returning id;
`;
}

function ottersqlProject(tables: number): Files {
  const indexes = tableIndexes(tables);
  const app = [
    'import type { Connection } from "@ottersql/sql";',
    ...indexes.map(
      (index) => `import * as t${String(index)} from "./queries/t${String(index)}.sql";`,
    ),
    ...indexes.map((index) =>
      usage(
        index,
        `  const row = await t${String(index)}.byId.maybeOne(db, { id: 1 });
  const list = await t${String(index)}.list(db, { status: "new" });
  const created = await t${String(index)}.insert.one(db, { name: "x", status: "new" });`,
        "db: Connection",
      ),
    ),
  ];
  return {
    "tsconfig.json": json({
      compilerOptions,
      contentMappers: [
        {
          package: "@ottersql/content-mapper",
          extensions: [".sql"],
          options: { schema: "schema.sql" },
        },
      ],
    }),
    "schema.sql": indexes.map((index) => tableSql(index)).join("\n"),
    ...Object.fromEntries(
      indexes.map((index) => [`queries/t${String(index)}.sql`, ottersqlQueries(index)]),
    ),
    "app.ts": app.join("\n"),
  };
}

function drizzleTable(index: number): string {
  const parent =
    index === 0
      ? ""
      : `\n  parentId: bigint("parent_id", { mode: "number" }).references(() => t${String(index - 1)}.id),`;
  return `export const t${String(index)} = pgTable("t${String(index)}", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  status: text("status").notNull().default("new"),
  amount: numeric("amount", { precision: 12, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),${parent}
});
`;
}

function drizzleProject(tables: number): Files {
  const indexes = tableIndexes(tables);
  const app = [
    'import { desc, eq } from "drizzle-orm";',
    'import type { NodePgDatabase } from "drizzle-orm/node-postgres";',
    'import * as schema from "./schema.ts";',
    "type Db = NodePgDatabase<typeof schema>;",
    ...indexes.map((index) => {
      const table = `schema.t${String(index)}`;
      return usage(
        index,
        `  const [row] = await db
    .select({ id: ${table}.id, name: ${table}.name, status: ${table}.status, amount: ${table}.amount, createdAt: ${table}.createdAt })
    .from(${table})
    .where(eq(${table}.id, 1));
  const list = await db
    .select({ id: ${table}.id, name: ${table}.name })
    .from(${table})
    .where(eq(${table}.status, "new"))
    .orderBy(desc(${table}.createdAt))
    .limit(20);
  const [created] = await db.insert(${table}).values({ name: "x", status: "new" }).returning({ id: ${table}.id });`,
        "db: Db",
      );
    }),
  ];
  return {
    "tsconfig.json": json({ compilerOptions }),
    "schema.ts": [
      'import { bigint, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";',
      ...indexes.map((index) => drizzleTable(index)),
    ].join("\n"),
    "app.ts": app.join("\n"),
  };
}

function kyselyTable(index: number): string {
  const parent = index === 0 ? "" : "\n  parent_id: string | null;";
  return `interface T${String(index)}Table {
  id: Generated<string>;
  name: string;
  status: Generated<string>;
  amount: string | null;
  created_at: Generated<Date>;${parent}
}
`;
}

function kyselyProject(tables: number): Files {
  const indexes = tableIndexes(tables);
  const app = [
    'import type { Generated, Kysely } from "kysely";',
    ...indexes.map((index) => kyselyTable(index)),
    "interface Database {",
    ...indexes.map((index) => `  t${String(index)}: T${String(index)}Table;`),
    "}",
    ...indexes.map((index) => {
      const table = `"t${String(index)}"`;
      return usage(
        index,
        `  const row = await db
    .selectFrom(${table})
    .select(["id", "name", "status", "amount", "created_at"])
    .where("id", "=", "1")
    .executeTakeFirst();
  const list = await db
    .selectFrom(${table})
    .select(["id", "name"])
    .where("status", "=", "new")
    .orderBy("created_at", "desc")
    .limit(20)
    .execute();
  const created = await db
    .insertInto(${table})
    .values({ name: "x", status: "new" })
    .returning("id")
    .executeTakeFirst();`,
        "db: Kysely<Database>",
      );
    }),
  ];
  return { "tsconfig.json": json({ compilerOptions }), "app.ts": app.join("\n") };
}

function prismaModel(index: number, tables: number): string {
  const name = `T${String(index)}`;
  const parent =
    index === 0
      ? ""
      : `\n  parentId  BigInt?   @map("parent_id")\n  parent    T${String(index - 1)}?       @relation(fields: [parentId], references: [id])`;
  const children = index === tables - 1 ? "" : `\n  children  T${String(index + 1)}[]`;
  return `model ${name} {
  id        BigInt   @id @default(autoincrement())
  name      String
  status    String   @default("new")
  amount    Decimal? @db.Decimal(12, 2)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz${parent}${children}

  @@map("t${String(index)}")
}
`;
}

function prismaProject(tables: number): Files {
  const indexes = tableIndexes(tables);
  const app = [
    'import type { PrismaClient } from "./generated/client.ts";',
    ...indexes.map((index) => {
      const model = `prisma.t${String(index)}`;
      return usage(
        index,
        `  const row = await ${model}.findUnique({
    where: { id: 1n },
    select: { id: true, name: true, status: true, amount: true, createdAt: true },
  });
  const list = await ${model}.findMany({
    where: { status: "new" },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, name: true },
  });
  const created = await ${model}.create({ data: { name: "x", status: "new" }, select: { id: true } });`,
        "prisma: PrismaClient",
      );
    }),
  ];
  return {
    "tsconfig.json": json({ compilerOptions }),
    "schema.prisma": [
      'generator client {\n  provider = "prisma-client"\n  output   = "./generated"\n}\n',
      'datasource db {\n  provider = "postgresql"\n}\n',
      ...indexes.map((index) => prismaModel(index, tables)),
    ].join("\n"),
    "app.ts": app.join("\n"),
  };
}

const writers: Readonly<Record<DevLibrary, (tables: number) => Files>> = {
  ottersql: ottersqlProject,
  drizzle: drizzleProject,
  kysely: kyselyProject,
  prisma: prismaProject,
};

/** The files of `library`'s project with `tables` tables. */
export function projectFiles(library: DevLibrary, tables: number): Files {
  return writers[library](tables);
}
