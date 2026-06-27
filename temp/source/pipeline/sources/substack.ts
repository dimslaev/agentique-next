import type { FetchedArticle } from "@shared/types";
import Parser from "rss-parser";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import { log } from "../utils";
import SOURCES from "./substack-sources.json";
import { cleanTitle, isWithinWindow } from "./utils";

const proxyUrl = process.env.RESIDENTIAL_PROXY_URL;
const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

// One-time, credential-redacted log so CI confirms what proxy (if any) is wired.
if (proxyUrl) {
  try {
    const u = new URL(proxyUrl);
    log(
      `Substack proxy: ${u.protocol}//${u.hostname}:${u.port || "(default)"} (auth: ${u.username ? "yes" : "no"})`,
    );
  } catch {
    log(`Substack proxy: set but unparseable as URL (len ${proxyUrl.length})`);
  }
} else {
  log(`Substack proxy: none (RESIDENTIAL_PROXY_URL unset)`);
}

// Recursively unwraps Error.cause so a bare undici "fetch failed" reveals the
// real reason (ENOTFOUND, ECONNREFUSED, SOCKS, TLS, proxy 407, etc.).
function describeError(err: unknown, depth = 0): string {
  const e = err as {
    name?: string;
    code?: string;
    message?: string;
    cause?: unknown;
  };
  if (!e) return String(err);
  const code = e.code !== undefined ? `(${e.code})` : "";
  const head = `${e.name ?? "Error"}${code}: ${e.message ?? e}`;
  if (e.cause && depth < 4)
    return `${head} <- ${describeError(e.cause, depth + 1)}`;
  return head;
}

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

// rss-parser fetches via Node's native https.get and ignores any custom
// transport, so it can never route through our residential proxy. Substack's
// native *.substack.com feeds sit behind Cloudflare and 403 datacenter IPs
// (e.g. CI runners), so we fetch the XML ourselves and hand the string to
// parser.parseString.
//
// Strategy: try a direct request first - this works for custom-domain feeds
// and from clean IPs, and keeps us off the proxy when we don't need it. Only
// when Cloudflare blocks us (403/429) do we retry through the residential
// proxy. Failures surface the underlying cause (undici wraps everything in a
// bare "fetch failed") so CI logs are diagnosable.
async function fetchOnce(url: string, useProxy: boolean) {
  try {
    return await undiciFetch(url, {
      headers: BROWSER_HEADERS,
      ...(useProxy && dispatcher ? { dispatcher } : {}),
    });
  } catch (err) {
    throw new Error(
      `fetch failed${useProxy ? " (via proxy)" : ""}: ${describeError(err)}`,
    );
  }
}

async function fetchFeedXml(
  url: string,
  retries = 2,
  backoff = 2000,
): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    // attempt 0 is direct; subsequent attempts route through the proxy if set
    const useProxy = attempt > 0 && !!dispatcher;
    const res = await fetchOnce(url, useProxy);
    if (res.ok) return res.text();
    if (
      (res.status === 403 || res.status === 429) &&
      attempt < retries &&
      dispatcher
    ) {
      await new Promise((r) => setTimeout(r, backoff * 2 ** attempt));
      continue;
    }
    throw new Error(`Status code ${res.status}`);
  }
}

const parser = new Parser({ timeout: 15_000 });

export async function fetchSubstack(): Promise<FetchedArticle[]> {
  const articles: FetchedArticle[] = [];

  const results = await Promise.all(
    SOURCES.map(async (source) => {
      log(`Fetching ${source.name}...`);
      try {
        const xml = await fetchFeedXml(source.rssUrl);
        const feed = await parser.parseString(xml);

        const withinWindow = (feed.items ?? []).filter((item) =>
          isWithinWindow(item.pubDate ?? item.isoDate),
        );

        log(`  ${source.name}: ${withinWindow.length} in window`);

        const items = withinWindow.map((item) => ({
          title: cleanTitle(item.title ?? "(no title)"),
          url: item.link ?? "",
          content: item.contentSnippet ?? item.content ?? "",
          publishedDate:
            item.pubDate ?? item.isoDate ?? new Date().toISOString(),
          source: source.name,
          sourceType: "rss" as const,
        }));

        return items;
      } catch (err) {
        log(`  FAILED ${source.name}: ${(err as Error).message}`);
        return [] as FetchedArticle[];
      }
    }),
  );

  for (const items of results) {
    articles.push(...items);
  }

  log(`Substack: ${articles.length} articles`);
  return articles;
}
