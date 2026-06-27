import { createClient } from "@libsql/client/web";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "../schema";

export type DrizzleClient = ReturnType<typeof drizzle>;

let _db: DrizzleClient | null = null;

export function initDb(env: {
  TURSO_DATABASE_URL: string;
  TURSO_AUTH_TOKEN?: string;
}) {
  if (!_db) {
    _db = drizzle(
      createClient({
        url: env.TURSO_DATABASE_URL,
        authToken: env.TURSO_AUTH_TOKEN,
      }),
      { schema },
    );
  }
}

export function db(): DrizzleClient {
  if (!_db) {
    const env =
      typeof process !== "undefined"
        ? (process as { env?: Record<string, string | undefined> }).env
        : {};
    _db = drizzle(
      createClient({
        url: env?.TURSO_DATABASE_URL ?? "",
        authToken: env?.TURSO_AUTH_TOKEN,
      }),
      { schema },
    );
  }
  return _db;
}

export async function ping(): Promise<void> {
  const { sql } = await import("drizzle-orm");
  await db().run(sql`SELECT 1`);
}
