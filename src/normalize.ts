import { Prisma } from "./prisma/generated/client.ts";

const timestampText =
  /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+\-]\d{2}(?::\d{2})?)$/v;
const numberText = /^-?\d+(?:\.\d+)?$/v;

function normalizeText(text: string): unknown {
  if (numberText.test(text)) {
    return String(Number(text));
  }
  return timestampText.test(text) ? Date.parse(text.replace(" ", "T")) : text;
}

/** Instants as epoch milliseconds and exact numbers as text, or `undefined` for anything else. */
function normalizeValue(value: object): unknown {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (value instanceof Temporal.Instant) {
    return value.epochMilliseconds;
  }
  return value instanceof Prisma.Decimal ? normalizeText(value.toString()) : undefined;
}

function normalizeObject(value: object): unknown {
  const entries = Object.entries(value)
    .map(([key, item]): [string, unknown] => [
      key.replaceAll("_", "").toLowerCase(),
      normalize(item),
    ])
    .toSorted(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(entries);
}

/**
 * A result in one shape whatever library produced it, so results can be compared: libraries agree
 * on the data but not on how they represent it. Instants become epoch milliseconds (Date, Temporal
 * and JSON text), exact numbers become canonical text (int8 as string, bigint or number; numeric as
 * string or Decimal), and keys lose case and underscores (`published_at` and `publishedAt`).
 */
export function normalize(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "bigint" || typeof value === "number" || typeof value === "string") {
    return normalizeText(String(value));
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalize(item));
  }
  if (typeof value !== "object") {
    return value;
  }
  return normalizeValue(value) ?? normalizeObject(value);
}
