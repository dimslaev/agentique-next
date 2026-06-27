// AI News source - extracts sub-stories from the news.smol.ai RSS feed.
//
// AI News is a daily aggregator of X/Twitter, Reddit, and Discord AI content.
// Each issue has two useful sections:
//   - <h1>AI Twitter Recap</h1>   - one editorial top-story per issue
//   - <h1>AI Reddit Recap</h1>    - multiple reddit posts, one per <a reddit.com/…/comments/…>
//
// We turn each issue into multiple FetchedArticle entries:
//   - One twitter-recap sub-story (title = first <strong>, primary URL = best
//     non-tweet link, content = first few bullets as summary)
//   - N reddit-recap sub-stories (one per reddit post anchor)
//
// Primary-URL priority: github > huggingface > arxiv > blog > reddit > tweet.
//
// This file is deliberately self-contained and does NOT reuse email.ts logic.

import type { FetchedArticle } from "@shared/types";
import { log } from "../utils";
import { fetchWithTimeout, isWithinWindow } from "./utils";

const FEED_URL = "https://news.smol.ai/rss.xml";
const MAX_CONTENT_LENGTH = 1400;
const MIN_REDDIT_BODY_LENGTH = 120;
const MIN_TWITTER_TITLE_LENGTH = 10;

type PrimaryKind =
  | "tweet"
  | "reddit"
  | "github"
  | "huggingface"
  | "arxiv"
  | "blog"
  | "other";

// ---------- feed parsing (no deps) ----------

const HTML_ENTITIES: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#x27;": "'",
  "&#x26;": "&",
  "&nbsp;": " ",
  "&amp;": "&",
};

function decodeHtml(s: string): string {
  return s.replace(
    /&(?:lt|gt|quot|apos|#x27|#x26|nbsp|amp);/g,
    (m) => HTML_ENTITIES[m],
  );
}

function pickTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  if (!match) return "";
  const cdata = match[1].match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  return cdata ? cdata[1] : match[1];
}

interface RssItem {
  title: string;
  link: string;
  contentHtml: string;
  pubDate: string;
}

function parseFeed(xml: string): RssItem[] {
  return xml
    .split("<item>")
    .slice(1)
    .map((chunk) => {
      const body = chunk.split("</item>")[0];
      return {
        title: pickTag(body, "title"),
        link: pickTag(body, "link"),
        contentHtml: decodeHtml(pickTag(body, "content:encoded")),
        pubDate: pickTag(body, "pubDate"),
      };
    });
}

// ---------- HTML helpers ----------

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstBold(html: string): string {
  const match = html.match(/<strong[^>]*>([\s\S]*?)<\/strong>/);
  return match ? stripTags(match[1]) : "";
}

interface Link {
  url: string;
  host: string;
  text: string;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function collectLinks(html: string): Link[] {
  const matches = html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g);
  return [...matches].map((m) => ({
    url: m[1],
    host: hostOf(m[1]),
    text: stripTags(m[2]),
  }));
}

/**
 * Extract the HTML region between a given <h1> and the next <h1>.
 * Returns an empty string when the heading is not present.
 */
function sliceSection(html: string, headingRx: RegExp): string {
  const start = html.search(headingRx);
  if (start === -1) return "";
  const afterStart = html.slice(start).replace(headingRx, "");
  const nextH1 = afterStart.search(/<h1[^>]*>/i);
  return nextH1 === -1 ? afterStart : afterStart.slice(0, nextH1);
}

// ---------- primary-URL priority ----------

const BLOG_HOST_RX =
  /\b(openai|anthropic|deepmind|google|meta|microsoft|nvidia|mistral|unsloth|databricks|cohere|stability|perplexity|vercel|modal|together|replicate|groq)\b/;

function classifyHost(host: string): PrimaryKind | null {
  if (host === "github.com" || host.endsWith(".github.io")) return "github";
  if (host === "huggingface.co" || host === "hf.co") return "huggingface";
  if (host === "arxiv.org" || host === "ar5iv.labs.arxiv.org") return "arxiv";
  if (
    BLOG_HOST_RX.test(host) ||
    host.endsWith(".ai") ||
    host.endsWith(".dev") ||
    host.includes("substack.com")
  ) {
    return "blog";
  }
  if (host === "reddit.com" || host.endsWith(".reddit.com")) return "reddit";
  if (host === "x.com" || host === "twitter.com") return "tweet";
  return null;
}

// Priority order applied when picking a primary link for a sub-story.
const PRIMARY_PRIORITY: PrimaryKind[] = [
  "github",
  "huggingface",
  "arxiv",
  "blog",
  "reddit",
  "tweet",
];

function isJunk(link: Link): boolean {
  if (!link.url) return true;
  if (
    link.host === "news.smol.ai" ||
    link.host === "latent.space" ||
    link.host === "support.substack.com" ||
    link.host === "i.redd.it" ||
    link.host === "preview.redd.it"
  ) {
    return true;
  }
  if (link.url.includes("twitter.com/i/lists/")) return true;
  if (link.url.includes("x.com/i/")) return true;
  return false;
}

function pickPrimary(links: Link[]): { url: string; kind: PrimaryKind } {
  const clean = links.filter((l) => !isJunk(l));
  if (clean.length === 0) return { url: "", kind: "other" };

  for (const kind of PRIMARY_PRIORITY) {
    const hit = clean.find((l) => classifyHost(l.host) === kind);
    if (hit) return { url: hit.url, kind };
  }
  return { url: clean[0].url, kind: "other" };
}

// ---------- Twitter Recap (one sub-story per issue) ----------

interface SubStory {
  title: string;
  url: string;
  content: string;
}

function extractTwitterRecap(html: string): SubStory | null {
  const region = sliceSection(html, /<h1[^>]*>\s*AI Twitter Recap\s*<\/h1>/i);
  if (!region) return null;

  const title = firstBold(region);
  if (!title || title.length < MIN_TWITTER_TITLE_LENGTH) return null;

  const { url } = pickPrimary(collectLinks(region));
  if (!url) return null;

  // Use the first few bullets as the summary instead of the full recap.
  const firstBullets = [...region.matchAll(/<li>([\s\S]*?)<\/li>/g)]
    .slice(0, 3)
    .map((m) => stripTags(m[1]))
    .join(" ");
  const summary =
    firstBullets || stripTags(region).slice(0, MAX_CONTENT_LENGTH);

  return { title, url, content: summary.slice(0, MAX_CONTENT_LENGTH) };
}

// ---------- Reddit Recap (one sub-story per post anchor) ----------

const REDDIT_ANCHOR_RX =
  /<a[^>]+href="(https?:\/\/(?:www\.)?reddit\.com\/r\/[^"]+\/comments\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;

interface RedditAnchor {
  url: string;
  title: string;
  start: number;
  end: number;
}

function findRedditAnchors(region: string): RedditAnchor[] {
  const anchors: RedditAnchor[] = [];
  for (const match of region.matchAll(REDDIT_ANCHOR_RX)) {
    anchors.push({
      url: match[1],
      title: stripTags(match[2]),
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    });
  }
  return anchors;
}

function extractRedditRecap(html: string): SubStory[] {
  const region = sliceSection(html, /<h1[^>]*>\s*AI Reddit Recap\s*<\/h1>/i);
  if (!region) return [];

  const anchors = findRedditAnchors(region);
  const stories: SubStory[] = [];

  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i];
    const nextAnchorStart =
      i + 1 < anchors.length ? anchors[i + 1].start : region.length;

    // Stop body at next anchor OR next h2/h3, whichever comes first.
    const afterAnchor = region.slice(anchor.end);
    const headingRel = afterAnchor.search(/<h[123][^>]*>/i);
    const headingAbs =
      headingRel === -1 ? region.length : anchor.end + headingRel;

    const bodyEnd = Math.min(nextAnchorStart, headingAbs);
    const body = region.slice(anchor.start, bodyEnd);
    const content = stripTags(body);
    if (content.length < MIN_REDDIT_BODY_LENGTH) continue;

    const { url } = pickPrimary(collectLinks(body));
    stories.push({
      title: anchor.title || "(untitled)",
      url: url || anchor.url,
      content: content.slice(0, MAX_CONTENT_LENGTH),
    });
  }
  return stories;
}

// ---------- fetch ----------

async function fetchFeedXml(): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(FEED_URL);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    return await res.text();
  } catch (err) {
    log(`  AI News fetch FAILED: ${err}`);
    return null;
  }
}

function toArticle(story: SubStory, pubDate: string): FetchedArticle {
  return {
    title: story.title,
    url: story.url,
    content: story.content,
    publishedDate: pubDate,
    source: "AI News",
    sourceType: "aiNews",
  };
}

export async function fetchAiNews(): Promise<FetchedArticle[]> {
  log("Fetching AI News feed...");

  const xml = await fetchFeedXml();
  if (!xml) return [];

  const items = parseFeed(xml).filter((it) => isWithinWindow(it.pubDate));
  log(`  AI News: ${items.length} issues within window`);

  const articles: FetchedArticle[] = [];
  for (const item of items) {
    // Skip low-signal days the editors tag as "not much happened".
    if (/^not much happened/i.test(item.title)) continue;

    const twitter = extractTwitterRecap(item.contentHtml);
    if (twitter) articles.push(toArticle(twitter, item.pubDate));

    for (const reddit of extractRedditRecap(item.contentHtml)) {
      articles.push(toArticle(reddit, item.pubDate));
    }
  }

  // Dedup by URL (same repo/post referenced in multiple issues).
  const byUrl = new Map<string, FetchedArticle>();
  for (const article of articles) {
    if (!byUrl.has(article.url)) byUrl.set(article.url, article);
  }
  const deduped = [...byUrl.values()];

  log(`AI News: ${deduped.length} articles extracted`);
  return deduped;
}
