import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { log } from "../utils";
import { fetchWithTimeout } from "./utils";

// These domains can't be scraped server-side - they always return error/login pages.
const SKIP_DOMAINS: string[] = ["x.com", "twitter.com"];
const SNIPPET_MAX_LENGTH = 500;
const EXTRACT_TIMEOUT_MS = 5_000;
const CONCURRENCY = 5;

function shouldSkip(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return SKIP_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return true;
  }
}

function ensureBody(html: string): string {
  if (/<body[\s>]/i.test(html)) return html;
  return `<html><head></head><body>${html}</body></html>`;
}

// Phrases that indicate a page blocked us instead of returning real content.
const BLOCKER_PATTERNS: RegExp[] = [
  /something went wrong.*don't fret/i,
  /disable.*privacy\s+extensions/i,
  /privacy\s+extensions.*and.*retry/i,
  /please\s+(?:sign|log)\s*in/i,
  /sign\s*in\s+to\s+(?:continue|read|access)/i,
  /log\s*in\s+to\s+(?:continue|read|access)/i,
  /subscribe\s+to\s+(?:continue|read|access|unlock)/i,
  /create\s+an?\s+account\s+to\s+(?:continue|read|access)/i,
  /enable\s+javascript\s+to\s+(?:continue|view|use)/i,
  /javascript\s+is\s+(?:disabled|required)/i,
  /access\s+denied/i,
  /403\s+forbidden/i,
];

function isBlockerContent(text: string): boolean {
  if (text.length < 50) return true; // too short to be real article text
  return BLOCKER_PATTERNS.some((re) => re.test(text));
}

function extractText(html: string, maxLength?: number): string {
  try {
    const { document } = parseHTML(ensureBody(html));
    const reader = new Readability(document as unknown as Document);
    const article = reader.parse();
    if (article) {
      const text =
        article.textContent?.replace(/\s+/g, " ").trim() ||
        article.excerpt ||
        "";
      if (!text || isBlockerContent(text)) return "";
      return maxLength !== undefined ? text.slice(0, maxLength) : text;
    }
  } catch {
    // fall through
  }
  return "";
}

async function extractHtml(url: string): Promise<string> {
  if (shouldSkip(url)) return "";

  try {
    const res = await fetchWithTimeout(url, EXTRACT_TIMEOUT_MS);
    if (!res.ok) return "";

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return "";

    return await res.text();
  } catch {
    return "";
  }
}

async function batchFetch(
  urls: string[],
  fn: (url: string, idx: number, total: number) => Promise<string>,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const batch = urls.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((url, j) =>
        fn(url, i + j, urls.length).then((value) => ({ url, value })),
      ),
    );
    for (const r of results) {
      if (r.status === "fulfilled" && r.value.value) {
        map.set(r.value.url, r.value.value);
      }
    }
  }
  return map;
}

export async function extractContent<
  T extends { url: string; content: string },
>(articles: T[]): Promise<T[]> {
  const needsContent = articles.filter((a) => !a.content);
  if (needsContent.length === 0) return articles;

  const uniqueUrls = [...new Set(needsContent.map((a) => a.url))];
  log(`  Extracting content for ${uniqueUrls.length} URLs...`);

  const snippetMap = await batchFetch(uniqueUrls, async (url) =>
    extractText(await extractHtml(url), SNIPPET_MAX_LENGTH),
  );

  log(`  Extracted ${snippetMap.size}/${uniqueUrls.length} snippets`);

  return articles.map((a) => {
    const snippet = snippetMap.get(a.url);
    return snippet ? { ...a, content: snippet } : a;
  });
}

export async function reExtractFullContent(
  articles: { url: string }[],
): Promise<Map<string, string>> {
  if (articles.length === 0) return new Map();

  const uniqueUrls = [...new Set(articles.map((a) => a.url))];
  log(`  Re-extracting full content for ${uniqueUrls.length} URLs...`);

  const contentMap = await batchFetch(uniqueUrls, async (url, idx, total) => {
    log(`    [${idx + 1}/${total}] Fetching: ${url}`);
    const t0 = Date.now();
    const content = extractText(await extractHtml(url));
    const ms = Date.now() - t0;
    log(
      `    [${idx + 1}/${total}] ${content ? `OK (${content.length} chars, ${ms}ms)` : `no content (${ms}ms)`}: ${url}`,
    );
    return content;
  });

  log(`  Re-extracted ${contentMap.size}/${uniqueUrls.length} full texts`);
  return contentMap;
}
