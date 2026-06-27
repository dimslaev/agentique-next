import type { FetchedArticle } from "@shared/types";
import Parser from "rss-parser";
import { resolveTwitterUrl } from "../search";
import { log } from "../utils";
import { cleanTitle, isWithinWindow } from "./utils";

const SOURCES = [
  { name: "Aligned News", rssUrl: "https://alignednews.com/feed.xml" },
];

/** Only ingest these RSS categories - others are noise (drama, events, business, etc.). */
const ALLOWED_CATEGORIES = new Set(["tips", "products"]);

const TWITTER_HOSTS = new Set(["x.com", "twitter.com", "t.co"]);

function isTwitterUrl(url: string): boolean {
  try {
    return TWITTER_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

type CustomItem = Parser.Item & { categories?: string[]; category?: string };

const parser = new Parser<Record<string, unknown>, CustomItem>({
  timeout: 15_000,
  headers: { "User-Agent": "Agentique/2.0 (+https://agentique.ch)" },
  customFields: { item: [["category", "category"]] },
});

export async function fetchRss(): Promise<FetchedArticle[]> {
  const articles: FetchedArticle[] = [];

  const results = await Promise.allSettled(
    SOURCES.map(async (source) => {
      log(`Fetching ${source.name}...`);
      const feed = await parser.parseURL(source.rssUrl);

      const withinWindow = (feed.items ?? []).filter((item) =>
        isWithinWindow(item.pubDate ?? item.isoDate),
      );

      // Filter to allowed categories
      const relevant = withinWindow.filter((item) => {
        const cats: string[] = Array.isArray(item.categories)
          ? item.categories
          : item.category
            ? [item.category as string]
            : [];
        return cats.some((c) => ALLOWED_CATEGORIES.has(c.toLowerCase()));
      });

      log(
        `  ${source.name}: ${withinWindow.length} in window, ${relevant.length} after category filter`,
      );

      // Resolve x.com URLs to real article URLs via Brave Search
      const resolved = await Promise.all(
        relevant.map(async (item) => {
          const rawUrl = item.link ?? "";
          const description = item.contentSnippet ?? item.content ?? "";
          const title = cleanTitle(item.title ?? "(no title)");

          let url = rawUrl;
          if (isTwitterUrl(rawUrl)) {
            log(`    Resolving tweet: ${title}`);
            const found = await resolveTwitterUrl(title, description);
            if (found) url = found;
          }

          return {
            title,
            url,
            // Use the RSS description as content - it's a quality AI summary,
            // far better than what scraping x.com would return.
            content: description,
            publishedDate:
              item.pubDate ?? item.isoDate ?? new Date().toISOString(),
            source: source.name,
            sourceType: "rss" as const,
          };
        }),
      );

      return { source: source.name, items: resolved };
    }),
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      log(
        `  ${result.value.source}: ${result.value.items.length} articles ready`,
      );
      articles.push(...result.value.items);
    } else {
      log(`  FAILED: ${result.reason}`);
    }
  }

  log(`RSS: ${articles.length} articles`);
  return articles;
}
