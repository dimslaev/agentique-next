import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  or,
  sql,
} from "drizzle-orm";
import * as schema from "../schema";
import type { DbArticle, FetchedArticle } from "../types";
import { db } from "./client";

function normalizeDate(dateStr: string | undefined): string | null {
  if (!dateStr) return null;
  try {
    return new Date(dateStr).toISOString();
  } catch {
    return dateStr;
  }
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export async function getRecentArticles(
  days: number,
): Promise<(DbArticle & { url: string })[]> {
  const rows = await db()
    .select()
    .from(schema.articles)
    .where(gte(schema.articles.published_at, daysAgoIso(days)))
    .orderBy(desc(schema.articles.published_at));
  return rows as unknown as (DbArticle & { url: string })[];
}

export async function insertArticle(article: FetchedArticle): Promise<number> {
  const result = await db()
    .insert(schema.articles)
    .values({
      title: article.title,
      content: article.content,
      source: article.source,
      source_type: article.sourceType,
      published_at: normalizeDate(article.publishedDate),
      url: article.url,
    })
    .returning({ id: schema.articles.id });
  const articleId = result[0].id;
  await db()
    .insert(schema.articleUrls)
    .values({ url: article.url, article_id: articleId });
  return articleId;
}

export async function updateScore(
  articleId: number,
  score: number,
): Promise<void> {
  await db()
    .update(schema.articles)
    .set({ score })
    .where(eq(schema.articles.id, articleId));
}

export async function updateCategories(
  articleId: number,
  summary: string,
  categories: string[],
): Promise<void> {
  await db()
    .update(schema.articles)
    .set({ summary, categories: JSON.stringify(categories) })
    .where(eq(schema.articles.id, articleId));
}

export async function updateKind(
  articleId: number,
  kind: string,
): Promise<void> {
  await db()
    .update(schema.articles)
    .set({ kind })
    .where(eq(schema.articles.id, articleId));
}

export async function updateContent(
  articleId: number,
  content: string,
): Promise<void> {
  await db()
    .update(schema.articles)
    .set({ content })
    .where(eq(schema.articles.id, articleId));
}

export async function updateTitle(
  articleId: number,
  title: string,
): Promise<void> {
  await db()
    .update(schema.articles)
    .set({ title })
    .where(eq(schema.articles.id, articleId));
}

export async function updateSummary(
  articleId: number,
  summary: string,
): Promise<void> {
  await db()
    .update(schema.articles)
    .set({ summary })
    .where(eq(schema.articles.id, articleId));
}

export interface ArticleFilterParams {
  q?: string;
  category?: string;
  kind?: string;
  since?: string;
  sort?: string;
  includeReleased?: boolean;
  minScore?: number;
  limit?: number;
}

const SORT_COLUMNS = new Set(["score", "published_at", "title", "source"]);

export async function getFilteredArticles(
  params: ArticleFilterParams,
): Promise<(Omit<DbArticle, "content"> & { url: string })[]> {
  const a = schema.articles;
  const conditions = [isNotNull(a.score)];

  if (!params.includeReleased) conditions.push(isNull(a.release_date));
  if (params.since) conditions.push(gte(a.published_at, params.since));
  if (params.minScore !== undefined)
    conditions.push(gte(a.score, params.minScore));
  if (params.kind) conditions.push(eq(a.kind, params.kind));
  if (params.q) {
    const pattern = `%${params.q}%`;
    conditions.push(
      or(like(a.title, pattern), like(a.summary, pattern)) as ReturnType<
        typeof eq
      >,
    );
  }
  if (params.category) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM json_each(${a.categories}) WHERE json_each.value = ${params.category})` as ReturnType<
        typeof eq
      >,
    );
  }

  let orderExpr = desc(a.score);
  if (params.sort) {
    const parts = params.sort.split("-");
    const dir = parts.pop();
    const col = parts.join("-");
    if (SORT_COLUMNS.has(col) && (dir === "asc" || dir === "desc")) {
      const colRef = a[col as keyof typeof a] as Parameters<typeof asc>[0];
      orderExpr = dir === "asc" ? asc(colRef) : desc(colRef);
    }
  }

  const q = db()
    .select({
      id: a.id,
      title: a.title,
      source: a.source,
      source_type: a.source_type,
      published_at: a.published_at,
      score: a.score,
      summary: a.summary,
      categories: a.categories,
      release_date: a.release_date,
      created_at: a.created_at,
      kind: a.kind,
      human_edits: a.human_edits,
      url: a.url,
    })
    .from(a)
    .where(and(...conditions))
    .orderBy(orderExpr);

  const rows = params.limit ? await q.limit(params.limit) : await q;
  return rows as unknown as (Omit<DbArticle, "content"> & { url: string })[];
}

export async function getUnreleasedArticles(): Promise<
  (DbArticle & { url: string })[]
> {
  const rows = await db()
    .select()
    .from(schema.articles)
    .where(
      and(
        isNull(schema.articles.release_date),
        isNotNull(schema.articles.score),
      ),
    )
    .orderBy(desc(schema.articles.score), desc(schema.articles.created_at));
  return rows as unknown as (DbArticle & { url: string })[];
}

export async function getAllArticles(
  includeReleased: boolean,
): Promise<(DbArticle & { url: string })[]> {
  if (includeReleased) {
    const rows = await db()
      .select()
      .from(schema.articles)
      .where(isNotNull(schema.articles.score))
      .orderBy(desc(schema.articles.created_at));
    return rows as unknown as (DbArticle & { url: string })[];
  }
  return getUnreleasedArticles();
}

export async function getArticlesByIds(
  ids: number[],
): Promise<(DbArticle & { url: string })[]> {
  if (ids.length === 0) return [];
  const rows = await db()
    .select()
    .from(schema.articles)
    .where(inArray(schema.articles.id, ids))
    .orderBy(desc(schema.articles.created_at));
  return rows as unknown as (DbArticle & { url: string })[];
}

export async function getArticleById(
  id: number,
): Promise<{ id: number; title: string; summary: string | null } | null> {
  const rows = await db()
    .select({
      id: schema.articles.id,
      title: schema.articles.title,
      summary: schema.articles.summary,
    })
    .from(schema.articles)
    .where(eq(schema.articles.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function releaseArticles(
  ids: number[],
  date: string,
): Promise<void> {
  await db()
    .update(schema.articles)
    .set({ release_date: date })
    .where(inArray(schema.articles.id, ids));
}

export interface ArticleUpdate {
  title?: string;
  score?: number | null;
  summary?: string | null;
  categories?: string[];
  kind?: string | null;
  source?: string;
  published_at?: string | null;
  addHumanEdits?: string[];
}

export async function updateArticle(
  articleId: number,
  fields: ArticleUpdate,
): Promise<void> {
  const set: Partial<typeof schema.articles.$inferInsert> = {};

  if (fields.title !== undefined) set.title = fields.title;
  if (fields.score !== undefined) set.score = fields.score;
  if (fields.summary !== undefined) set.summary = fields.summary;
  if (fields.categories !== undefined)
    set.categories = JSON.stringify(fields.categories);
  if (fields.kind !== undefined) set.kind = fields.kind;
  if (fields.source !== undefined) set.source = fields.source;
  if (fields.published_at !== undefined) set.published_at = fields.published_at;

  if (fields.addHumanEdits?.length) {
    const rows = await db()
      .select({ human_edits: schema.articles.human_edits })
      .from(schema.articles)
      .where(eq(schema.articles.id, articleId))
      .limit(1);
    const current = rows[0]?.human_edits ?? "[]";
    set.human_edits = JSON.stringify([
      ...new Set([
        ...(JSON.parse(current) as string[]),
        ...fields.addHumanEdits,
      ]),
    ]);
  }

  if (Object.keys(set).length === 0) return;
  await db()
    .update(schema.articles)
    .set(set)
    .where(eq(schema.articles.id, articleId));
}

export async function deleteArticle(articleId: number): Promise<void> {
  await db()
    .delete(schema.articleUrls)
    .where(eq(schema.articleUrls.article_id, articleId));
  await db().delete(schema.articles).where(eq(schema.articles.id, articleId));
}

export async function updateEmbedding(
  articleId: number,
  vecString: string,
): Promise<void> {
  // vector32() is a Turso-specific function — kept as raw SQL
  await db().run(
    sql`UPDATE articles SET embedding = vector32(${vecString}) WHERE id = ${articleId}`,
  );
}

export async function searchArticlesByEmbedding(
  queryVecString: string,
  limit = 20,
): Promise<(DbArticle & { url: string })[]> {
  // vector_top_k is a Turso-specific table-valued function — kept as raw SQL
  const rows = await db().all<DbArticle & { url: string }>(
    sql`SELECT a.*
        FROM articles a
        INNER JOIN (SELECT rowid FROM vector_top_k('idx_articles_embedding', ${queryVecString}, ${limit})) v ON a.id = v.rowid
        WHERE a.score IS NOT NULL`,
  );
  return rows;
}

export async function getArticlesWithoutEmbeddings(): Promise<
  { id: number; title: string; summary: string | null }[]
> {
  return db()
    .select({
      id: schema.articles.id,
      title: schema.articles.title,
      summary: schema.articles.summary,
    })
    .from(schema.articles)
    .where(
      and(
        isNotNull(schema.articles.score),
        isNotNull(schema.articles.summary),
        isNull(schema.articles.embedding),
      ),
    );
}

export async function getArticleStats(): Promise<{
  total: number;
  lastUpdated: string | null;
}> {
  const rows = await db().all<{ total: number; last: string | null }>(
    sql`SELECT COUNT(*) as total, MAX(created_at) as last FROM articles WHERE score IS NOT NULL`,
  );
  return { total: rows[0]?.total ?? 0, lastUpdated: rows[0]?.last ?? null };
}
