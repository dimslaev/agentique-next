import { eq, inArray } from "drizzle-orm";
import * as schema from "../schema";
import { db } from "./client";

export async function urlExists(url: string): Promise<boolean> {
  const rows = await db()
    .select({ url: schema.articleUrls.url })
    .from(schema.articleUrls)
    .where(eq(schema.articleUrls.url, url))
    .limit(1);
  return rows.length > 0;
}

export async function urlsExist(urls: string[]): Promise<Set<string>> {
  if (urls.length === 0) return new Set();
  const rows = await db()
    .select({ url: schema.articleUrls.url })
    .from(schema.articleUrls)
    .where(inArray(schema.articleUrls.url, urls));
  return new Set(rows.map((r) => r.url));
}

export async function scoredUrlsExist(urls: string[]): Promise<Set<string>> {
  if (urls.length === 0) return new Set();
  const rows = await db()
    .select({ url: schema.scoredUrls.url })
    .from(schema.scoredUrls)
    .where(inArray(schema.scoredUrls.url, urls));
  return new Set(rows.map((r) => r.url));
}

export async function markUrlsScored(urls: string[]): Promise<void> {
  if (urls.length === 0) return;
  await db()
    .insert(schema.scoredUrls)
    .values(urls.map((url) => ({ url })))
    .onConflictDoNothing();
}

export async function getArticleIdByUrl(url: string): Promise<number | null> {
  const rows = await db()
    .select({ article_id: schema.articleUrls.article_id })
    .from(schema.articleUrls)
    .where(eq(schema.articleUrls.url, url))
    .limit(1);
  return rows[0]?.article_id ?? null;
}

export async function addUrlToArticle(
  url: string,
  articleId: number,
): Promise<void> {
  await db()
    .insert(schema.articleUrls)
    .values({ url, article_id: articleId })
    .onConflictDoNothing();
}

export async function updateArticleUrl(
  articleId: number,
  newUrl: string,
): Promise<void> {
  await db()
    .update(schema.articleUrls)
    .set({ url: newUrl })
    .where(eq(schema.articleUrls.article_id, articleId));
  await db()
    .update(schema.articles)
    .set({ url: newUrl })
    .where(eq(schema.articles.id, articleId));
}
