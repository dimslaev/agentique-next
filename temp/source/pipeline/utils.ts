// Genuinely cross-cutting helpers - used from both the web app side
// (app/api/*) and the pipeline/sources/scripts side.
//
// Source-layer helpers (cleanTitle, fetchWithTimeout, isWithinWindow) live
// in src/sources/utils.ts.

const TIMEZONE = "Europe/Zurich";

export function todayDateString(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: TIMEZONE });
}

export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function log(message: string): void {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${message}`);
}

// Strip wrapper artifacts the LLM sometimes echoes around an improved title:
// a leading "[Source]" tag and surrounding straight or smart quotes.
// Returns the bare title text.
export function stripTitleWrappers(text: string): string {
  let s = text.trim();
  s = s.replace(/^\[[^\]]+\]\s*/, "");
  s = s.replace(/^\d+\.\s*/, "");
  const pairs: [string, string][] = [
    ['"', '"'],
    ["'", "'"],
    ["“", "”"],
    ["‘", "’"],
  ];
  for (const [open, close] of pairs) {
    if (s.startsWith(open) && s.endsWith(close) && s.length >= 2) {
      s = s.slice(open.length, s.length - close.length).trim();
      break;
    }
  }
  return s;
}

// Strip smart quotes, emoji, and other unicode junk LLMs like to emit.
export function sanitizeLlmText(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201A]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/\u2192/g, "->")
    .replace(/\u2190/g, "<-")
    .replace(/\u2194/g, "<->")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u2022\u2023\u25E6\u25AA\u25AB]/g, "-")
    .replace(
      /[\p{Emoji_Presentation}\p{Extended_Pictographic}]\uFE0F?(\u200D[\p{Emoji_Presentation}\p{Extended_Pictographic}]\uFE0F?)*/gu,
      "",
    )
    .replace(/ {2,}/g, " ")
    .trim();
}
