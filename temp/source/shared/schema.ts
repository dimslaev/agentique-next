import { sql } from "drizzle-orm";
import {
  blob,
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const articles = sqliteTable(
  "articles",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    title: text("title").notNull(),
    content: text("content").default(""),
    source: text("source").notNull(),
    source_type: text("source_type").notNull(),
    published_at: text("published_at"),
    score: integer("score"),
    summary: text("summary"),
    categories: text("categories").default("[]"),
    kind: text("kind"),
    human_edits: text("human_edits").default("[]"),
    // embedding is F32_BLOB(1024) — Turso-specific; kept as raw blob, managed via raw SQL
    embedding: blob("embedding"),
    url: text("url"),
    release_date: text("release_date"),
    created_at: text("created_at").default(sql`(datetime('now'))`),
  },
  (t) => [
    index("idx_articles_score").on(t.score),
    index("idx_articles_published_at").on(t.published_at),
  ],
);

export const articleUrls = sqliteTable("article_urls", {
  url: text("url").primaryKey(),
  article_id: integer("article_id")
    .notNull()
    .references(() => articles.id),
});

export const meta = sqliteTable("meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updated_at: text("updated_at").default(sql`(datetime('now'))`),
});

export const scoredUrls = sqliteTable("scored_urls", {
  url: text("url").primaryKey(),
  scored_at: text("scored_at").default(sql`(datetime('now'))`),
});

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  name: text("name"),
  created_at: text("created_at").default(sql`(datetime('now'))`),
  newsletter_categories: text("newsletter_categories"),
  newsletter_custom: text("newsletter_custom"),
  newsletter_utm_source: text("newsletter_utm_source"),
  newsletter_updated_at: text("newsletter_updated_at"),
  // key_plain dropped — API keys are show-once; only the hash is stored
  key_hash: text("key_hash").unique(),
  credits_remaining: integer("credits_remaining").default(0),
  last_used_at: text("last_used_at"),
  github_username: text("github_username"),
  referred_by: text("referred_by"),
});

export const apiCalls = sqliteTable(
  "api_calls",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    user_id: integer("user_id").notNull(),
    endpoint: text("endpoint").notNull(),
    params: text("params").notNull().default("{}"),
    created_at: text("created_at").default(sql`(datetime('now'))`),
  },
  (t) => [
    index("idx_api_calls_created_at").on(t.created_at),
    index("idx_api_calls_user_id").on(t.user_id),
  ],
);
