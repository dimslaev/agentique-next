import { mkdir, readdir, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import type { FetchedArticle } from "@shared/types";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { b } from "../../baml_client";
import { search } from "../search";
import { log } from "../utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NewsletterSource {
  sender: string;
  name: string;
}

/**
 * A product named by a newsletter, before its canonical URL is resolved.
 * Carries the issue metadata so the eventual FetchedArticle keeps attribution.
 */
interface RawProduct {
  name: string;
  description: string;
  emailDate: string;
  newsletterName: string;
}

// ---------------------------------------------------------------------------
// Newsletter sources
//
// No per-provider link resolver: we never decode tracking redirects. The AI
// reads the products a newsletter reports on (from anchor text + prose) and we
// rediscover each canonical URL by web search. The only per-source data is the
// sender→name mapping used for attribution.
// ---------------------------------------------------------------------------

export const NEWSLETTER_SOURCES: NewsletterSource[] = [
  {
    sender: "@deeperlearning.producthunt.com",
    name: "The Frontier by Product Hunt",
  },
  { sender: "bensbites@substack.com", name: "Ben's Bites" },
  { sender: "@changelog.com", name: "Changelog News" },
  { sender: "@deeplearning.ai", name: "The Batch" },
  { sender: "@tldrnewsletter.com", name: "TLDR" },
  { sender: "@console.dev", name: "Console" },
  { sender: "@pointer.io", name: "Pointer" },
  { sender: "@importai.net", name: "Import AI" },
  { sender: "@theneurondaily.com", name: "The Neuron" },
  { sender: "@aihero.dev", name: "AI Hero" },
  { sender: "@mail.theresanaiforthat.com", name: "There's An AI For That" },
  { sender: "@daily.therundown.ai", name: "The Rundown AI" },
  { sender: "@technews.therundown.ai", name: "The Rundown AI Tech" },
  { sender: "@mail.joinsuperhuman.ai", name: "Superhuman" },
  { sender: "agentai@mail.beehiiv.com", name: "AgentAI" },
];

// ---------------------------------------------------------------------------
// Sender matching
// ---------------------------------------------------------------------------

function matchSender(address: string): { name: string } | undefined {
  const addr = address.toLowerCase();
  for (const source of NEWSLETTER_SOURCES) {
    const pattern = source.sender.toLowerCase();
    if (pattern.startsWith("@") ? addr.endsWith(pattern) : addr === pattern) {
      return { name: source.name };
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Product extraction (1 AI call per email)
// ---------------------------------------------------------------------------

// Strip an email's HTML to text, keeping anchor text and surrounding prose.
// Links are kept as [text](href) as a weak hint, but the hrefs are not trusted
// (they are usually tracking redirects); product identity comes from the words.
function htmlToText(html: string): string {
  const cleaned = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(
      /<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
      (_, href, text) => {
        const cleanText = text.replace(/<[^>]+>/g, "").trim();
        return cleanText
          ? `[${cleanText}](${href.replace(/&amp;/g, "&")})`
          : "";
      },
    )
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#\d+;/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, 50_000);
}

async function extractProducts(
  html: string,
  newsletterName: string,
  emailDate: string,
): Promise<RawProduct[]> {
  const text = htmlToText(html);
  if (!text) return [];

  try {
    const products = await b.ExtractProducts(text);
    return products
      .filter((p) => p.name?.trim())
      .map((p) => ({
        name: p.name.trim(),
        description: p.description?.trim() ?? "",
        emailDate,
        newsletterName,
      }));
  } catch (err) {
    log(`  Failed to extract products from ${newsletterName}: ${err}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// URL resolution via search + verify
// ---------------------------------------------------------------------------

const RESOLVE_CONCURRENCY = 5;
const SEARCH_CANDIDATES = 5;

// Domains that are never a product's first-party source: social posts, video,
// and aggregators/content farms. Stripped from candidates before the AI picks,
// so a junk hit can't win by default (the model alone didn't reliably reject
// them). A product whose only hit is one of these is dropped rather than linked.
const DENY_DOMAINS = [
  "x.com",
  "twitter.com",
  "t.co",
  "linkedin.com",
  "reddit.com",
  "threads.net",
  "mastodon.social",
  "facebook.com",
  "instagram.com",
  "youtube.com",
  "youtu.be",
  "digg.com",
  "medium.com",
  "news.ycombinator.com",
];

function isDenied(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return DENY_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return true; // unparseable URL is not a usable link
  }
}

/**
 * One product → one canonical URL. Searches for candidates and lets the AI pick
 * the best first-party result, rejecting social/aggregator/SEO pages and wrong
 * products. Returns null when no candidate is clearly the right source.
 */
async function resolveOne(p: RawProduct): Promise<FetchedArticle | null> {
  const query = `${p.name} ${p.description}`.trim();

  let results: Awaited<ReturnType<typeof search>>;
  try {
    results = await search(query, { maxResults: SEARCH_CANDIDATES });
  } catch (err) {
    log(`    Search failed for "${p.name}": ${err}`);
    return null;
  }
  results = results.filter((r) => !isDenied(r.url));
  if (results.length === 0) {
    log(`    No usable search result for "${p.name}"`);
    return null;
  }

  let choiceIdx = 0;
  try {
    const choice = await b.SelectProductLink(
      p.name,
      p.description,
      results.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.description,
      })),
    );
    choiceIdx = choice.index;
  } catch (err) {
    log(`    Link selection failed for "${p.name}": ${err}`);
    return null;
  }

  // index is 1-based; 0 means "no candidate is a clean first-party source".
  const picked = choiceIdx >= 1 ? results[choiceIdx - 1] : undefined;
  if (!picked) {
    log(`    Dropped "${p.name}": no first-party result among candidates`);
    return null;
  }

  return {
    title: p.name,
    url: picked.url,
    content: p.description,
    publishedDate: p.emailDate,
    source: p.newsletterName,
    sourceType: "newsletter" as const,
  };
}

/**
 * Dedupe products by name across all issues in this run (one launch is often
 * covered by several newsletters the same day), drop the un-notable ones, then
 * resolve each survivor to a URL. The dedupe + notability gate are what keep
 * search volume within free Tavily quota.
 */
async function resolveProducts(raw: RawProduct[]): Promise<FetchedArticle[]> {
  if (raw.length === 0) return [];

  const byName = new Map<string, RawProduct>();
  for (const p of raw) {
    const key = p.name.toLowerCase();
    if (!byName.has(key)) byName.set(key, p);
  }
  const unique = [...byName.values()];

  // Notability gate (one batched AI call) before spending any web search.
  let products = unique;
  try {
    const keep = await b.SelectNotableProducts(
      unique.map((p) => ({ name: p.name, description: p.description })),
    );
    const keepIdx = new Set(keep);
    const selected = unique.filter((_, i) => keepIdx.has(i + 1));
    // Guard against a degenerate empty response dropping everything.
    if (selected.length > 0) products = selected;
  } catch (err) {
    log(`  Notability filter failed, resolving all: ${err}`);
  }

  log(
    `  Resolving ${products.length} notable products via search ` +
      `(${raw.length} raw → ${unique.length} unique → ${products.length} notable)`,
  );

  const articles: FetchedArticle[] = [];
  for (let i = 0; i < products.length; i += RESOLVE_CONCURRENCY) {
    const batch = products.slice(i, i + RESOLVE_CONCURRENCY);
    const resolved = await Promise.all(batch.map(resolveOne));
    for (const a of resolved) if (a) articles.push(a);
  }
  log(`  Resolved ${articles.length}/${products.length} products to URLs`);
  return articles;
}

// ---------------------------------------------------------------------------
// IMAP config + error handling
// ---------------------------------------------------------------------------

function getImapConfig() {
  const host = process.env.IMAP_HOST;
  const port = Number(process.env.IMAP_PORT || 993);
  const user = process.env.IMAP_USER;
  const pass = process.env.IMAP_PASSWORD;

  if (!host || !user || !pass) {
    throw new Error(
      "Missing IMAP env vars: IMAP_HOST, IMAP_USER, IMAP_PASSWORD",
    );
  }
  return { host, port, user, pass };
}

// imapflow throws a bare `Error: Command failed` when the server returns NO/BAD,
// stashing the useful detail on these extra fields. Surface them so failures
// are diagnosable instead of a one-line mystery.
interface ImapError extends Error {
  responseStatus?: string;
  responseText?: string;
  executedCommand?: string;
  authenticationFailed?: boolean;
  code?: string;
}

/** Flatten an imapflow error into a single diagnostic line. */
function describeError(err: unknown): string {
  const e = err as ImapError;
  const parts: string[] = [e?.message ?? String(err)];
  if (e?.responseStatus) parts.push(`status=${e.responseStatus}`);
  if (e?.responseText) parts.push(`response=${JSON.stringify(e.responseText)}`);
  if (e?.executedCommand) parts.push(`command=${e.executedCommand}`);
  if (e?.code) parts.push(`code=${e.code}`);
  return parts.join(" ");
}

/** Auth failures won't recover on retry; NO/BAD/throttle/network might. */
function isFatal(err: unknown): boolean {
  return (err as ImapError)?.authenticationFailed === true;
}

/** Honor a server-suggested backoff (throttling) else exponential, capped at 30s. */
function backoffMs(err: unknown, attempt: number): number {
  const txt = (err as ImapError)?.responseText;
  const m = txt?.match(/Backoff Time[:=\s]+(\d+)/i);
  if (m) return Math.min(Number(m[1]), 30_000);
  return Math.min(1000 * 2 ** (attempt - 1), 30_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  attempts = 3,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (isFatal(err)) {
        log(`  ${label} failed (fatal, not retrying): ${describeError(err)}`);
        throw err;
      }
      log(
        `  ${label} attempt ${attempt}/${attempts} failed: ${describeError(err)}`,
      );
      if (attempt < attempts) {
        const delay = backoffMs(err, attempt);
        log(`    retrying in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// IMAP fetch
// ---------------------------------------------------------------------------

/**
 * One full connect → fetch → mark-seen → logout cycle, returning the raw
 * products named across all unread newsletter emails. Throws on any IMAP error
 * so withRetry can decide whether to retry. The socket is closed on failure so
 * dead attempts don't pile up against the server's connection limit.
 */
async function runImapFetch(
  config: ReturnType<typeof getImapConfig>,
): Promise<RawProduct[]> {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: true,
    auth: { user: config.user, pass: config.pass },
    logger: false,
  });

  const raw: RawProduct[] = [];

  try {
    await client.connect();
    const lock = await client.getMailboxLock("sub");

    try {
      // 1. Find unread emails from known newsletter senders
      const uidMatches = new Map<number, { name: string }>();
      for await (const msg of client.fetch(
        { seen: false },
        { envelope: true, uid: true },
      )) {
        const fromAddr = msg.envelope?.from?.[0]?.address?.toLowerCase();
        const match = fromAddr ? matchSender(fromAddr) : undefined;
        if (match) uidMatches.set(msg.uid, match);
      }

      const uids = [...uidMatches.keys()];
      log(`  Found ${uids.length} unread newsletter emails`);

      if (uids.length > 0) {
        // 2. Download full messages and extract products
        const processedUids: number[] = [];
        for await (const msg of client.fetch(
          { uid: uids.join(",") },
          { envelope: true, source: true, uid: true },
        )) {
          const match = uidMatches.get(msg.uid);
          if (!match) continue;

          const emailDate =
            msg.envelope?.date?.toISOString() ?? new Date().toISOString();
          const subject = msg.envelope?.subject ?? "(no subject)";

          log(`  Processing: ${match.name} (${subject})`);

          if (!msg.source) {
            log(`    No message source, skipping`);
            processedUids.push(msg.uid);
            continue;
          }

          const parsed = await simpleParser(msg.source as Buffer);
          const html =
            typeof parsed.html === "string"
              ? parsed.html
              : (parsed.textAsHtml ?? "");
          if (!html) {
            log(`    No HTML content, skipping`);
            processedUids.push(msg.uid);
            continue;
          }

          const products = await extractProducts(html, match.name, emailDate);
          log(`    Found ${products.length} products`);
          raw.push(...products);

          processedUids.push(msg.uid);
        }
        // 3. Mark all processed emails as seen (after fetch stream is done)
        if (processedUids.length > 0) {
          await client.messageFlagsAdd(
            { uid: processedUids.join(",") },
            ["\\Seen"],
            { uid: true },
          );
        }
      }
    } finally {
      lock.release();
    }

    await client.logout();
  } catch (err) {
    // Close the socket before a retry so failed attempts don't accumulate
    // against the server's concurrent-connection limit.
    try {
      client.close();
    } catch {
      /* already closed */
    }
    throw err;
  }

  return raw;
}

export async function fetchNewsletter(): Promise<FetchedArticle[]> {
  if (NEWSLETTER_SOURCES.length === 0) {
    log("Newsletter: no sources configured, skipping");
    return [];
  }

  const config = getImapConfig();
  log(`Connecting to ${config.host} as ${config.user}...`);

  let raw: RawProduct[] = [];
  try {
    raw = await withRetry(() => runImapFetch(config), "Newsletter IMAP");
  } catch (err) {
    log(`Newsletter fetch failed after retries: ${describeError(err)}`);
  }

  const articles = await resolveProducts(raw);
  log(`Newsletter: ${articles.length} articles extracted`);
  return articles;
}

// ---------------------------------------------------------------------------
// Local .eml import
// ---------------------------------------------------------------------------

export async function fetchLocalEmails(
  dir = "emails",
): Promise<FetchedArticle[]> {
  const files: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".eml")) {
        files.push(join(dir, entry.name));
      } else if (entry.isDirectory() && entry.name !== "processed") {
        const subEntries = await readdir(join(dir, entry.name));
        for (const sub of subEntries) {
          if (sub.endsWith(".eml")) {
            files.push(join(dir, entry.name, sub));
          }
        }
      }
    }
  } catch {
    log("Local emails: directory not found, skipping");
    return [];
  }

  if (files.length === 0) {
    log("Local emails: no .eml files found, skipping");
    return [];
  }

  log(`Local emails: found ${files.length} .eml files`);

  const raw: RawProduct[] = [];
  const processedDir = join(dir, "processed");

  for (const filePath of files) {
    const file = filePath.split("/").pop() ?? filePath;
    const rawEml = await readFile(filePath, "utf-8");
    const parsed = await simpleParser(rawEml);

    const fromAddr = parsed.from?.value?.[0]?.address?.toLowerCase() ?? "";
    const match = matchSender(fromAddr);
    const newsletterName = match?.name ?? `Unknown (${fromAddr})`;

    const emailDate = parsed.date?.toISOString() ?? new Date().toISOString();
    const subject = parsed.subject ?? "(no subject)";

    const html =
      typeof parsed.html === "string" ? parsed.html : (parsed.textAsHtml ?? "");
    if (!html) {
      log(`  ${file}: no HTML content, skipping`);
      continue;
    }

    log(
      `  Processing: ${newsletterName} - ${subject} (${emailDate.slice(0, 10)})`,
    );

    const products = await extractProducts(html, newsletterName, emailDate);
    log(`    Found ${products.length} products`);
    raw.push(...products);

    await mkdir(processedDir, { recursive: true });
    await rename(filePath, join(processedDir, file));
  }

  const articles = await resolveProducts(raw);
  log(`Local emails: ${articles.length} articles extracted`);
  return articles;
}
