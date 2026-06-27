// Shared helpers used across pipeline steps.
//
// - trustBySource:    maps source name -> "high" | "medium" | "low"
// - toArticleInputs:  builds ArticleInput[] from FetchedArticle[] for BAML calls

import type { ArticleKind, FetchedArticle } from "@shared/types";
import type { ArticleInput } from "../baml_client/types";
import { NEWSLETTER_SOURCES } from "./sources/email";

// Minimum ScoreArticles score (1-100) an article must reach to be kept.
// Shared by the pipeline (run.ts) and the feed-discovery gate (sources/discover)
// so a feed is only added when its recent items would survive the same bar.
export const SCORE_THRESHOLD = 76;

// Source trust is used as a signal in the scoring prompt: high-trust sources
// get a +1 bonus when content quality is comparable. Newsletter sources are
// curated by humans, so they all count as high trust.
export const trustBySource: Record<string, string> = {
  "Hacker News": "high",
  "AI News": "high",
};
for (const ns of NEWSLETTER_SOURCES) {
  trustBySource[ns.name] = "high";
}

/**
 * Detects a GitHub repo link inside fetched article content.
 * Matches github.com/owner/repo paths; ignores non-repo pages like
 * github.com/features or github.com/login.
 * Returns the matched URL, or null if none found.
 */
export function githubRepoFromContent(content: string): string | null {
  const match = content.match(
    /https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/,
  );
  if (!match) return null;
  const [, owner, repo] = match;
  // Filter out GitHub meta-pages that aren't repos
  const nonRepoOwners = new Set([
    "features",
    "login",
    "pricing",
    "about",
    "marketplace",
    "explore",
    "topics",
    "collections",
    "trending",
    "sponsors",
    "orgs",
    "apps",
    "contact",
    "security",
  ]);
  if (nonRepoOwners.has(owner.toLowerCase())) return null;
  return `https://github.com/${owner}/${repo}`;
}

/**
 * URL-based kind detection - overrides LLM classification for unambiguous cases.
 * Returns null when the URL gives no signal (LLM should decide).
 */
export function kindFromUrl(url: string): ArticleKind | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host === "github.com" || host === "gitlab.com") return "repo";
    if (host === "huggingface.co" || host === "hf.co") return "model";
    if (host === "arxiv.org" || host === "ar5iv.labs.arxiv.org") return "paper";
  } catch {
    // malformed URL - fall through
  }
  return null;
}

// Converts FetchedArticles to ArticleInput for BAML scoring/dedup/title calls.
// Snippets are capped at 200 chars - enough signal for the LLM without
// paying the cost of the full content we captured during fetch.
export function toArticleInputs(articles: FetchedArticle[]): ArticleInput[] {
  return articles.map(
    (a): ArticleInput => ({
      url: a.url,
      title: a.title,
      source: a.source,
      snippet: a.content ? a.content.slice(0, 200) : undefined,
      trust: trustBySource[a.source],
    }),
  );
}
