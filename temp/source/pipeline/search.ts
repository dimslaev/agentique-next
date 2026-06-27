// Tavily Search API client.
// Set TAVILY_API_KEY in your environment.
//
// Usage:
//   const results = await search("OpenShell v0.0.26 microVM AI agents", { maxResults: 3 });

import { log } from "./utils";

const TAVILY_API_URL = "https://api.tavily.com/search";

export interface SearchResult {
  title: string;
  url: string;
  description: string;
}

export interface SearchOptions {
  /** Max results to return (default: 5). */
  maxResults?: number;
}

export async function search(
  query: string,
  options: SearchOptions = {},
): Promise<SearchResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("TAVILY_API_KEY is not set");

  const { maxResults = 5 } = options;

  const res = await fetch(TAVILY_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey, query, max_results: maxResults }),
  });

  if (!res.ok) {
    throw new Error(`Tavily Search API error: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as {
    results?: { title: string; url: string; content?: string }[];
  };

  return (data.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    description: r.content ?? "",
  }));
}

/**
 * Given an x.com / twitter.com URL and a title/description, searches for
 * the underlying article and returns the best non-Twitter result URL.
 * Returns null if nothing useful is found.
 */
export async function resolveTwitterUrl(
  title: string,
  description: string,
): Promise<string | null> {
  // Strip twitter handles (@Foo -) and RSS formatting noise from the title
  const cleanTitle = title.replace(/^@\w+\s+[-–-]\s+/, "").trim();

  // Use title + first sentence of description as query
  const firstSentence = description.split(/\.\s+/)[0]?.trim() ?? "";
  const query = firstSentence ? `${cleanTitle} ${firstSentence}` : cleanTitle;

  try {
    const results = await search(query, { maxResults: 5 });

    const BLOCKED = ["x.com", "twitter.com", "t.co"];
    const match = results.find((r) => !BLOCKED.some((b) => r.url.includes(b)));

    if (match) {
      log(`    Resolved to: ${match.url}`);
      return match.url;
    }
  } catch (err) {
    log(`    Search failed: ${err}`);
  }

  return null;
}
