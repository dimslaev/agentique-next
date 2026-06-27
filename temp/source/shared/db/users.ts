import { and, eq, gte, sql } from "drizzle-orm";
import * as schema from "../schema";
import { db } from "./client";

export async function getUserByEmail(email: string): Promise<{
  id: number;
  key_hash: string | null;
  credits_remaining: number;
  github_username: string | null;
} | null> {
  const rows = await db()
    .select({
      id: schema.users.id,
      key_hash: schema.users.key_hash,
      credits_remaining: schema.users.credits_remaining,
      github_username: schema.users.github_username,
    })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    key_hash: r.key_hash,
    credits_remaining: r.credits_remaining ?? 0,
    github_username: r.github_username ?? null,
  };
}

export async function ensureUserByEmail(email: string): Promise<{
  id: number;
  key_hash: string | null;
  credits_remaining: number;
  github_username: string | null;
}> {
  await db().insert(schema.users).values({ email }).onConflictDoNothing();
  const u = await getUserByEmail(email);
  if (!u) throw new Error(`Failed to upsert user ${email}`);
  return u;
}

export async function upsertNewsletterPrefs(params: {
  email: string;
  categories: string[];
  custom: string;
  utm_source?: string | null;
}): Promise<void> {
  await db()
    .insert(schema.users)
    .values({
      email: params.email,
      newsletter_categories: JSON.stringify(params.categories),
      newsletter_custom: params.custom,
      newsletter_utm_source: params.utm_source ?? null,
      newsletter_updated_at: sql`(datetime('now'))`,
    })
    .onConflictDoUpdate({
      target: schema.users.email,
      set: {
        newsletter_categories: JSON.stringify(params.categories),
        newsletter_custom: params.custom,
        newsletter_utm_source: params.utm_source ?? null,
        newsletter_updated_at: sql`(datetime('now'))`,
      },
    });
}

export async function creditUser(params: {
  email: string;
  name?: string | null;
  credits: number;
}): Promise<void> {
  await db()
    .insert(schema.users)
    .values({
      email: params.email,
      name: params.name ?? null,
      credits_remaining: params.credits,
    })
    .onConflictDoUpdate({
      target: schema.users.email,
      set: {
        credits_remaining: sql`${schema.users.credits_remaining} + ${params.credits}`,
        name: sql`COALESCE(${schema.users.name}, ${params.name ?? null})`,
      },
    });
}

export async function setUserKeyHash(
  userId: number,
  keyHash: string,
): Promise<void> {
  await db()
    .update(schema.users)
    .set({ key_hash: keyHash })
    .where(eq(schema.users.id, userId));
}

export async function verifyKey(
  keyHash: string,
): Promise<{ userId: number; balance: number } | null> {
  const rows = await db()
    .select({
      id: schema.users.id,
      credits_remaining: schema.users.credits_remaining,
    })
    .from(schema.users)
    .where(eq(schema.users.key_hash, keyHash))
    .limit(1);
  if (rows.length === 0) return null;
  return { userId: rows[0].id, balance: rows[0].credits_remaining ?? 0 };
}

export async function chargeCredits(
  userId: number,
  cost: number,
): Promise<boolean> {
  const result = await db()
    .update(schema.users)
    .set({
      credits_remaining: sql`${schema.users.credits_remaining} - ${cost}`,
      last_used_at: sql`(datetime('now'))`,
    })
    .where(
      and(
        eq(schema.users.id, userId),
        gte(schema.users.credits_remaining, cost),
      ),
    );
  return (result.rowsAffected ?? 0) > 0;
}

export async function setGithubUsername(
  userId: number,
  username: string,
): Promise<void> {
  await db()
    .update(schema.users)
    .set({ github_username: username })
    .where(eq(schema.users.id, userId));
}

export async function setReferredBy(
  userId: number,
  referrerUsername: string,
): Promise<void> {
  await db().run(
    sql`UPDATE users SET referred_by = ${referrerUsername} WHERE id = ${userId} AND referred_by IS NULL`,
  );
}

export async function getUserByGithubUsername(username: string): Promise<{
  id: number;
  email: string;
} | null> {
  const rows = await db()
    .select({ id: schema.users.id, email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.github_username, username))
    .limit(1);
  return rows[0] ?? null;
}

export async function logApiCall(
  userId: number,
  endpoint: string,
  params: Record<string, string | number | undefined>,
): Promise<void> {
  await db()
    .insert(schema.apiCalls)
    .values({ user_id: userId, endpoint, params: JSON.stringify(params) });
}

export async function getGithubAccessToken(
  baUserId: string,
): Promise<string | null> {
  const rows = await db().all<{ access_token: string | null }>(
    sql`SELECT access_token FROM account WHERE user_id = ${baUserId} AND provider_id = 'github' LIMIT 1`,
  );
  return rows[0]?.access_token ?? null;
}
