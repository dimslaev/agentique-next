export const ARTICLE_CATEGORIES = ["models", "dev", "research"] as const;

export type ArticleCategory = (typeof ARTICLE_CATEGORIES)[number];

export const ARTICLE_KINDS = [
  "repo",
  "paper",
  "model",
  "blog",
  "product",
  "announcement",
] as const;

export type ArticleKind = (typeof ARTICLE_KINDS)[number];

export interface FetchedArticle {
  title: string;
  url: string;
  content: string;
  publishedDate: string;
  source: string;
  sourceType: "rss" | "hackerNews" | "newsletter" | "aiNews";
}

export interface DbArticle {
  id: number;
  /** Sanitized at insert; may be rewritten by ImproveTitles. */
  title: string;
  /** Full article text extracted at ingest time. Capped before LLM calls. */
  content: string;
  /** Human-readable source name, e.g. "Hacker News", "AI News", "Ben's Bites". */
  source: string;
  /** Source channel: "rss" | "hackerNews" | "newsletter" | "aiNews". */
  source_type: string;
  /** Original publication date from the source (RSS pubDate, newsletter date, etc.). Shown in UI. */
  published_at: string | null;
  /** 1–10 relevance score from ScoreArticles. NULL = not yet scored or deleted (score=NULL hides from UI). */
  score: number | null;
  /** 2–3 line summary from SummarizeAndCategorize. NULL = not yet summarized. */
  summary: string | null;
  /** JSON array of ArticleCategory strings, e.g. '["models","dev"]'. */
  categories: string;
  /** Content format: "repo" | "paper" | "model" | "blog" | "product" | "announcement". */
  kind: string | null;
  /** Date the article was included in a released newsletter edition. NULL = not yet released. Gates UI visibility. */
  release_date: string | null;
  /** When the article row was inserted into the DB. Used for pipeline windows (e.g. review-week -7 days). */
  created_at: string;
  /** JSON array of field names manually edited by a human, e.g. '["score","categories"]'. Pipelines should not overwrite these. */
  human_edits?: string;
}

export interface Source {
  name: string;
  rssUrl: string;
  weight: number;
}
