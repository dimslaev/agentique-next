import "dotenv/config";
import { promises as dnsPromises } from "node:dns";
import { setLogLevel } from "@boundaryml/baml/logging";
import {
  getRecentArticles,
  insertArticle,
  updateCategories,
  updateContent,
  updateEmbedding,
  updateKind,
  updateScore,
  updateTitle,
} from "@shared/db/articles";
import {
  addUrlToArticle,
  getArticleIdByUrl,
  markUrlsScored,
  scoredUrlsExist,
  urlsExist,
} from "@shared/db/urls";
import { embeddingToVecString, getEmbedding } from "@shared/embeddings";
import type { FetchedArticle } from "@shared/types";
import { b } from "../baml_client";
import type { ExistingArticle } from "../baml_client/types";
import { fetchAiNews } from "./sources/ainews";
import { fetchNewsletter } from "./sources/email";
import { reExtractFullContent } from "./sources/extract-content";
import { fetchHN } from "./sources/hn";
// import { fetchRss } from "../sources/rss";
import { fetchSubstack } from "./sources/substack";
import {
  githubRepoFromContent,
  kindFromUrl,
  SCORE_THRESHOLD,
  toArticleInputs,
} from "./steps";
import { log, sanitizeLlmText, stripTitleWrappers, wait } from "./utils";

const SOURCES: { label: string; fetcher: () => Promise<FetchedArticle[]> }[] = [
  { label: "Hacker News", fetcher: fetchHN },
  { label: "Newsletter", fetcher: fetchNewsletter },
  { label: "AI News", fetcher: fetchAiNews },
  { label: "Substack", fetcher: fetchSubstack },
  // { label: "RSS", fetcher: fetchRss },
];

const PROMPT_CONTENT_CAP = 1500;

export async function runPipeline(): Promise<void> {
  log("=== Pipeline start ===");
  const start = Date.now();

  const all: Awaited<ReturnType<typeof summarizeAndCategorize>> = [];

  for (const src of SOURCES) {
    log(`\n=== Processing ${src.label} ===`);

    const fetched = await fetchSource(src.fetcher, src.label);
    const fresh = await filterKnownUrls(fetched, src.label);
    const alive = await filterDeadDomains(fresh, src.label);
    const unique = await dedupSemantic(alive, src.label);
    const scored = await scoreArticles(unique);
    const inserted = await insertArticles(scored);
    await improveTitles(inserted);
    const withContent = await extractFullContent(inserted);
    const processed = await summarizeAndCategorize(withContent);
    await embedArticles(processed);

    all.push(...processed);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  log(`=== Pipeline complete in ${elapsed}s ===`);
}

// ─── Steps ───────────────────────────────────────────────────────────────────

/** Step 01 - Call the source fetcher; log if nothing came back. */
async function fetchSource(
  fetcher: () => Promise<FetchedArticle[]>,
  label: string,
): Promise<FetchedArticle[]> {
  const articles = await fetcher();
  if (articles.length === 0) log(`No articles from ${label}`);
  return articles;
}

/** Step 02 - Drop URLs already present in articles or scored_urls. */
async function filterKnownUrls(
  articles: FetchedArticle[],
  label: string,
): Promise<FetchedArticle[]> {
  if (articles.length === 0) return [];

  const allUrls = articles.map((a) => a.url);
  const existing = await urlsExist(allUrls);
  const alreadyScored = await scoredUrlsExist(allUrls);
  const fresh = articles.filter(
    (a) => !existing.has(a.url) && !alreadyScored.has(a.url),
  );

  if (existing.size > 0 || alreadyScored.size > 0) {
    log(
      `  Filtered ${existing.size} known + ${alreadyScored.size} already-scored URLs`,
    );
  }
  if (fresh.length === 0) {
    log(`  No new articles from ${label}`);
    return [];
  }
  log(`  ${fresh.length} new articles to process`);
  return fresh;
}

/** Step 02b - Drop articles whose hostname does not resolve in DNS. */
async function filterDeadDomains(
  articles: FetchedArticle[],
  label: string,
): Promise<FetchedArticle[]> {
  if (articles.length === 0) return articles;

  const checks = await Promise.all(
    articles.map(async (a) => ({
      article: a,
      ok: await isDomainResolvable(a.url),
    })),
  );

  const alive = checks.filter((c) => c.ok).map((c) => c.article);
  const deadCount = checks.length - alive.length;
  if (deadCount > 0) {
    for (const c of checks) {
      if (!c.ok) log(`  Dropped dead URL: ${c.article.url}`);
    }
    log(`  Filtered ${deadCount} dead-domain URLs from ${label}`);
  }
  return alive;
}

async function isDomainResolvable(url: string): Promise<boolean> {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  try {
    await dnsPromises.lookup(host);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException)?.code !== "ENOTFOUND";
  }
}

/**
 * Step 03 - Drop articles that are the same story as a recent DB entry.
 * Merges the duplicate URL onto the existing row; falls back gracefully on AI failure.
 */
async function dedupSemantic(
  articles: FetchedArticle[],
  label: string,
): Promise<FetchedArticle[]> {
  if (articles.length === 0) return articles;

  const recentDb = await getRecentArticles(14);
  if (recentDb.length === 0) return articles;

  log(`  Deduplicating against ${recentDb.length} recent DB articles...`);

  const newInput = toArticleInputs(articles);

  const existingInput = recentDb.map(
    (a): ExistingArticle => ({
      url: a.url,
      title: a.title,
      source: a.source,
    }),
  );

  try {
    const matches = await b.SemanticDedup(newInput, existingInput);

    for (const match of matches) {
      const existingId = await getArticleIdByUrl(match.existingUrl);
      if (existingId) {
        await addUrlToArticle(match.url, existingId);
        log(`  Merged: ${match.url} -> existing article #${existingId}`);
      }
    }

    const mergedUrls = new Set(matches.map((m) => m.url));
    const unique = articles.filter((a) => !mergedUrls.has(a.url));
    if (mergedUrls.size > 0)
      log(`  ${mergedUrls.size} articles merged with existing`);
    if (unique.length === 0) log(`  No new unique articles from ${label}`);
    return unique;
  } catch (err) {
    log(`  Dedup failed, continuing without: ${err}`);
    return articles;
  }
}

/**
 * Step 04 - Score articles via BAML; keep those >= SCORE_THRESHOLD.
 * Records ALL evaluated URLs in scored_urls so they're skipped next run.
 * Ben's Bites gets a +10 bonus (capped at 100) to offset its summarized style.
 */
async function scoreArticles(
  articles: FetchedArticle[],
): Promise<{ article: FetchedArticle; score: number }[]> {
  if (articles.length === 0) return [];

  log(`  Scoring ${articles.length} articles in batches of 10...`);

  const BATCH = 5;
  const allScores: { url: string; score: number }[] = [];
  for (let i = 0; i < articles.length; i += BATCH) {
    const batch = toArticleInputs(articles.slice(i, i + BATCH));
    const result = await b.ScoreArticles(batch);
    allScores.push(...result);
    log(
      `    batch ${Math.ceil((i + BATCH) / BATCH)}/${Math.ceil(articles.length / BATCH)} done`,
    );
    await wait(1000);
  }

  const scoreByUrl = new Map(allScores.map((s) => [s.url, s.score]));
  const scored = articles
    .map((a) => {
      let score = scoreByUrl.get(a.url) ?? 0;
      if (a.source === "Ben's Bites") score = Math.min(score + 10, 100);
      return { article: a, score };
    })
    .sort((a, b) => b.score - a.score);

  const kept = scored.filter((s) => s.score >= SCORE_THRESHOLD);
  log(`  ${kept.length} articles pass scoring (threshold: ${SCORE_THRESHOLD})`);

  await markUrlsScored(articles.map((a) => a.url));

  return kept;
}

/** Step 05 - Insert scored articles into the DB; returns id+article+score triples. */
async function insertArticles(
  scored: { article: FetchedArticle; score: number }[],
): Promise<{ id: number; article: FetchedArticle; score: number }[]> {
  if (scored.length === 0) return [];

  // Dedup within batch: same URL from multiple newsletters - keep highest score
  const byUrl = new Map<string, { article: FetchedArticle; score: number }>();
  for (const item of scored) {
    const existing = byUrl.get(item.article.url);
    if (!existing || item.score > existing.score)
      byUrl.set(item.article.url, item);
  }
  const deduped = [...byUrl.values()];

  const inserted: { id: number; article: FetchedArticle; score: number }[] = [];
  for (const { article, score } of deduped) {
    article.title = sanitizeLlmText(article.title);
    const id = await insertArticle(article);
    await updateScore(id, score);
    inserted.push({ id, article, score });
    log(`  Inserted #${id}: [${score}/10] ${article.title}`);
  }
  return inserted;
}

/**
 * Step 06 - Send every inserted article through ImproveTitles, one per call.
 * Per-article calls eliminate cross-batch hallucinations we observed at batch
 * sizes of 5+ (model occasionally attached one article's snippet to another's URL).
 */
async function improveTitles(
  inserted: { id: number; article: FetchedArticle; score: number }[],
): Promise<void> {
  if (inserted.length === 0) return;

  log(`  Improving ${inserted.length} titles...`);

  for (const { id, article } of inserted) {
    const input = toArticleInputs([article]);
    try {
      const fixes = await b.ImproveTitles(input);
      const raw = fixes[0]?.title;
      if (!raw) continue;
      const sanitized = sanitizeLlmText(stripTitleWrappers(raw));
      if (!sanitized || sanitized === article.title) continue;
      if (sanitized.toLowerCase().includes(article.source.toLowerCase())) {
        log(
          `  Skip rewrite #${id} (source name leaked into output): "${sanitized}"`,
        );
        continue;
      }
      const oldTitle = article.title;
      await updateTitle(id, sanitized);
      article.title = sanitized;
      log(`  Improved title #${id}: "${oldTitle}" → "${sanitized}"`);
    } catch (err) {
      log(`  Title improve failed for #${id}, continuing: ${err}`);
    }
  }
}

/**
 * Step 07 - Re-fetch full article text for kept articles (uncapped).
 * AI News items are skipped - their recap prose is already the right input for step 08.
 */
async function extractFullContent(
  inserted: { id: number; article: FetchedArticle; score: number }[],
): Promise<
  { id: number; article: FetchedArticle; score: number; fullContent: string }[]
> {
  if (inserted.length === 0) return [];

  const toExtract = inserted.filter(
    (a) => a.article.sourceType !== "aiNews" && a.article.sourceType !== "rss",
  );
  const contentMap = await reExtractFullContent(
    toExtract.map((a) => ({ url: a.article.url })),
  );

  for (const { id, article } of toExtract) {
    const full = contentMap.get(article.url);
    if (full) await updateContent(id, full);
  }

  return inserted.map((item) => {
    if (
      item.article.sourceType === "aiNews" ||
      item.article.sourceType === "rss"
    ) {
      return { ...item, fullContent: item.article.content };
    }
    return { ...item, fullContent: contentMap.get(item.article.url) ?? "" };
  });
}

/**
 * Step 08 - Summarize and categorize each article.
 * Falls back to CategorizeOnly (title-only) when no body was extracted.
 * Demotes non-Models 10/10 scores to 9 to keep the top bar meaningful.
 */
async function summarizeAndCategorize(
  items: {
    id: number;
    article: FetchedArticle;
    score: number;
    fullContent: string;
  }[],
): Promise<
  {
    id: number;
    url: string;
    title: string;
    score: number;
    summary: string;
    categories: string[];
  }[]
> {
  if (items.length === 0) return [];

  log(`  Summarizing and categorizing ${items.length} articles...`);

  const processed: {
    id: number;
    url: string;
    title: string;
    score: number;
    summary: string;
    categories: string[];
  }[] = [];

  for (const { id, article, score, fullContent } of items) {
    let summary = "";
    let categories: string[] = [];
    let kind: string | null = kindFromUrl(article.url);

    try {
      if (fullContent) {
        const result = await b.SummarizeAndCategorize(
          article.title,
          fullContent.slice(0, PROMPT_CONTENT_CAP),
        );
        summary = sanitizeLlmText(result.summary ?? "");
        categories = result.categories.map((c) => c.toLowerCase());
        if (!kind) kind = result.kind.toLowerCase();
        if (kind === "blog" && githubRepoFromContent(fullContent))
          kind = "repo";
      } else {
        const result = await b.CategorizeOnly(article.title);
        categories = result.categories.map((c) => c.toLowerCase());
        if (!kind) {
          const kindResult = await b.ClassifyKind(
            article.title,
            article.url,
            undefined,
          );
          kind = kindResult.kind.toLowerCase();
        }
      }
    } catch (err) {
      log(`  Summarize/categorize failed for #${id}: ${err}`);
    }

    await updateCategories(id, summary, categories);
    if (kind) await updateKind(id, kind);

    processed.push({
      id,
      url: article.url,
      title: article.title,
      score,
      summary,
      categories,
    });
  }

  log(`  Done summarizing and categorizing`);
  return processed;
}

/** Step 09 - Generate and store a semantic embedding for each processed article. */
async function embedArticles(
  items: { id: number; title: string; summary: string }[],
): Promise<void> {
  if (items.length === 0) return;

  log(`  Embedding ${items.length} articles...`);

  for (const { id, title, summary } of items) {
    try {
      const text = summary ? `${title}\n\n${summary}` : title;
      const vec = await getEmbedding(text, "passage");
      await updateEmbedding(id, embeddingToVecString(vec));
    } catch (err) {
      log(`  Embed failed for #${id}: ${err}`);
    }
  }
}

// CLI entry point
if (!process.env.BAML_LOG) setLogLevel("ERROR");

runPipeline()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
