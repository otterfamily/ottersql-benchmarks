import type { OpenLibrary } from "./cases.ts";
import { openDrizzle } from "./drizzle/library.ts";
import { openKysely } from "./kysely/library.ts";
import { openOttersql } from "./ottersql/library.ts";
import { openPg } from "./pg/library.ts";
import { openPrisma } from "./prisma/library.ts";

/** Every library under benchmark, by the name results use. The first is the baseline. */
export const libraries: Readonly<Record<string, OpenLibrary>> = {
  pg: openPg,
  ottersql: openOttersql,
  drizzle: openDrizzle,
  kysely: openKysely,
  prisma: openPrisma,
};
