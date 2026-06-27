// Source-layer helpers shared between hn, rss, email, and extract-content.

const HN_PREFIX_RE = /^(?:Show|Launch|Ask|Tell) HN:\s*/i;

// Strip "Show HN:" / "Ask HN:" style prefixes from story titles.
export function cleanTitle(title: string): string {
  return title.replace(HN_PREFIX_RE, "").trim();
}

const FETCH_TIMEOUT_MS = 15_000;

export async function fetchWithTimeout(
  url: string,
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const WINDOW_HOURS = 168;

// True if `dateStr` is within the last N hours (default 1 week).
// Missing/unparseable dates are treated as "within" (pass-through).
export function isWithinWindow(
  dateStr: string | undefined,
  windowHours: number = WINDOW_HOURS,
): boolean {
  if (!dateStr) return true;
  const published = new Date(dateStr);
  const now = new Date();
  const hoursAgo = (now.getTime() - published.getTime()) / (1000 * 60 * 60);
  return hoursAgo <= windowHours;
}
