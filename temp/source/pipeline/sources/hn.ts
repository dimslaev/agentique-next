import type { FetchedArticle } from "@shared/types";
import { log } from "../utils";
import { extractContent } from "./extract-content";
import { cleanTitle, fetchWithTimeout, isWithinWindow } from "./utils";

const HN_TOP = "https://hacker-news.firebaseio.com/v0/topstories.json";
const HN_ITEM = "https://hacker-news.firebaseio.com/v0/item";
const HN_FETCH_LIMIT = 200;

const HN_AI_KEYWORDS =
  /\b(ai|llm|gpt|claude|gemini|llama|openai|anthropic|deepseek|mistral|opencode|tokens|transformer|diffusion|machine.?learning|deep.?learning|neural.?net|language.?model|artificial.?intelligen|stable.?diffusion|midjourney|copilot|chatbot|rag|fine.?tun|embedding|token|lora|rlhf|gguf|ollama|hugging.?face)\b/i;

interface HNItem {
  id: number;
  title?: string;
  url?: string;
  score?: number;
  descendants?: number;
  time?: number;
  type?: string;
}

export async function fetchHN(): Promise<FetchedArticle[]> {
  log("Fetching Hacker News top stories...");
  const res = await fetchWithTimeout(HN_TOP);
  const ids: number[] = (await res.json()) as number[];

  const topIds = ids.slice(0, HN_FETCH_LIMIT);
  const results = await Promise.allSettled(
    topIds.map(async (id) => {
      const r = await fetchWithTimeout(`${HN_ITEM}/${id}.json`);
      return r.json() as Promise<HNItem>;
    }),
  );

  const articles: FetchedArticle[] = [];
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const item = result.value;
    if (!item || item.type !== "story" || !item.title) continue;
    if (!HN_AI_KEYWORDS.test(item.title)) continue;
    const pubDate = item.time
      ? new Date(item.time * 1000).toISOString()
      : undefined;
    if (!isWithinWindow(pubDate)) continue;

    const cleaned = cleanTitle(item.title);
    articles.push({
      title: cleaned,
      url: item.url ?? `https://news.ycombinator.com/item?id=${item.id}`,
      content: "",
      publishedDate: pubDate ?? new Date().toISOString(),
      source: "Hacker News",
      sourceType: "hackerNews",
    });
  }

  log(`Hacker News: ${articles.length} AI-related stories`);
  return extractContent(articles);
}
