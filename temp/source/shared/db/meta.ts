import { eq, like, sql } from "drizzle-orm";
import * as schema from "../schema";
import { db } from "./client";

export async function setMeta(key: string, value: string): Promise<void> {
  await db()
    .insert(schema.meta)
    .values({ key, value })
    .onConflictDoUpdate({
      target: schema.meta.key,
      set: { value, updated_at: sql`(datetime('now'))` },
    });
}

export async function getMeta(key: string): Promise<string | null> {
  const rows = await db()
    .select({ value: schema.meta.value })
    .from(schema.meta)
    .where(eq(schema.meta.key, key))
    .limit(1);
  return rows[0]?.value ?? null;
}

export async function getMetaByPrefix(
  prefix: string,
): Promise<Record<string, string>> {
  const rows = await db()
    .select({ key: schema.meta.key, value: schema.meta.value })
    .from(schema.meta)
    .where(like(schema.meta.key, `${prefix}%`));
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key.slice(prefix.length)] = row.value;
  }
  return result;
}
