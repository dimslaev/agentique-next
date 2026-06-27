# Ingestion pipeline migration — Python rewrite on VPS

**Goal:** Rewrite the TypeScript news-ingestion pipeline as a Python job running on the VPS, writing directly to Postgres. No HTTP ingest endpoint. Eliminates Node.js from the stack.

**Shipping in two phases** (per decision): **v1** = HN + AI News + Substack sources end-to-end; **v2** = email/newsletter source as a fast follow.

## Source reference

The original TypeScript source is copied to `temp/source/` in this repo for reference during the rewrite:

```
temp/source/
  pipeline/           ← run.ts, steps.ts, utils.ts, search.ts, sources/*
  baml_src/           ← all .baml prompt files
  shared/             ← types.ts, embeddings.ts, db/articles.ts, db/urls.ts
```

Read these before porting each module — they are the authoritative reference for logic, prompt wording, and data shapes. **This plan is self-contained for cloud execution: an agent should be able to implement it from this file + `temp/source/` alone.**

---

## Architecture

```
Docker compose service "pipeline" (cron, 04:00 daily)
  └─ python -m pipeline.run
       ├─ sources/hn.py          ← HN API + keyword filter        [v1]
       ├─ sources/ainews.py      ← news.smol.ai RSS, self-contained [v1]
       ├─ sources/substack.py    ← 100+ feeds + proxy/retry         [v1]
       ├─ sources/email.py       ← IMAP + 3 BAML calls + Tavily      [v2]
       ├─ BAML Python client     ← same .baml files, Python generator
       ├─ model2vec               ← potion-base-8M 256-d, same as backend
       └─ SQLModel / Postgres    ← direct writes via app.models_agentique
```

Pipeline lives in `backend/pipeline/` — same `uv` environment and `pyproject.toml` as the backend, so it can `from app.models_agentique import Article` directly and reuse the backend's embedding model.

---

## Execution on VPS — dedicated compose service (DECIDED)

The backend is Dockerized (`compose.yml`: `db`, `backend`, `frontend`, `prestart`, `adminer`). The pipeline runs as a **new compose service built from the backend image**, on the same network as `db`, with an internal scheduler. This keeps one Python environment, one image, and DB access over the internal Docker network (no exposed DB port).

```yaml
# compose.yml — new service (sketch)
pipeline:
  image: '${DOCKER_IMAGE_BACKEND?Variable not set}:${TAG-latest}'
  networks:
    - default
  depends_on:
    db:
      condition: service_healthy
  environment:
    - DATABASE_URL=...        # same as backend
    - NVIDIA_NIM_API_KEY=...
    - TAVILY_API_KEY=...      # v2
    - IMAP_HOST/PORT/USER/PASSWORD=...   # v2
    - RESIDENTIAL_PROXY_URL=...
  command: supercronic /app/pipeline/crontab
```

Use **supercronic** (container-friendly cron, logs to stdout, no root cron daemon quirks) with a `crontab` file:

```cron
0 4 * * * cd /app && python -m pipeline.run
```

Rationale over alternatives: a host-cron `docker compose exec` couples the schedule to host state; a host `uv` venv duplicates the Python env and forces exposing the DB port. The compose service is the most reproducible and matches how the rest of the stack is deployed.

> Note: `compose.yml` is an upstream-owned file — adding a service is additive and low-conflict, but record it in `CHANGES.md`.

---

## BAML migration

Add a Python generator to `baml_src/generators.baml` (keep the existing TS generator — both can coexist):

```
generator python {
  output_type "python/pydantic"
  output_dir "../backend/"
  version "0.223.0"
}
```

Run `baml generate` → produces `backend/baml_client/` (Python, pydantic models). **Commit it** (Docker builds from committed files; no `baml generate` at build time). No `.baml` prompt changes needed. LLM clients stay on NVIDIA NIM (`Fast`/`Nvidia`/`NvidiaGptOss`, same `NVIDIA_NIM_API_KEY`).

### BAML functions actually used (CORRECTED — verified against source)

| BAML function | Phase | Used in |
|---|---|---|
| `ScoreArticles` | v1 | score step |
| `SemanticDedup` | v1 | dedup-detect step (see "Dedup" below) |
| `ImproveTitles` | v1 | title cleanup |
| `SummarizeAndCategorize` | v1 | summarize + categorize |
| `CategorizeOnly` | v1 | fallback when no content extracted |
| `ClassifyKind` | v1 | fallback kind classification |
| `ExtractProducts` | **v2** | email — extract named products from newsletter HTML |
| `SelectNotableProducts` | **v2** | email — gate which products get web-searched |
| `SelectProductLink` | **v2** | email — pick best first-party URL among Tavily candidates |

**Not ported** (not used by the ingestion pipeline): `ExtractLinks` (`extract_links.baml`), `ClassifyProfiles` (`discover.baml`) — these belong to a separate discovery feature. Leave their `.baml` files in place but generate-and-ignore.

---

## Python dependencies to add (`backend/pyproject.toml`)

| Package | Replaces | Phase |
|---|---|---|
| `baml-py` | `@boundaryml/baml` | v1 |
| `trafilatura` | `@mozilla/readability` + `linkedom` (extract-content) | v1 |
| `feedparser` | `rss-parser` (AI News, Substack RSS) | v1 |
| `httpx` | `fetchWithTimeout` / `undici` (incl. proxy support) | v1 |
| `dnspython` | `node:dns` dead-domain filter | v1 |
| `regex` | TS unicode-property regex in `sanitizeLlmText` (Python `re` lacks `\p{...}`) | v1 |
| `tavily-python` | `search.ts` Tavily client | v2 |
| `imapclient` | `imapflow` | v2 |
| `mail-parser` | `mailparser` | v2 |

`model2vec`, `pgvector`, `sqlmodel` already present.

> **Substack proxy:** `httpx` supports proxies natively (`httpx.Client(proxy=...)`). Port `substack.ts`'s retry-on-403/429 + residential-proxy-on-retry logic explicitly — it's not just "feedparser". See porting hazards.

---

## DB additions

### `ScoredUrl` table (new — add to `models_agentique.py`)

```python
class ScoredUrl(SQLModel, table=True):
    __tablename__ = "scored_url"
    url: str = Field(primary_key=True)
    created_at: datetime = Field(default_factory=get_datetime_utc)
```

New Alembic migration: `create table scored_url (url text primary key, created_at timestamptz)`.

### `content` column — ALREADY EXISTS (CORRECTED)

`models_agentique.py:28` already defines `content: str | None = Field(default="")`. **No migration needed.** (Earlier draft wrongly claimed it was missing.)

### No `article_urls` table (per dedup decision below)

The TS schema had an `article_urls` junction for URL aliasing. We are **not** porting it — see Dedup.

---

## Dedup — detect and drop, no URL merge (DECIDED)

The TS `dedupSemantic` step (run.ts:147–193) calls `SemanticDedup` to find new articles that match an existing recent DB article, then **merges** the new URL onto the existing article via `getArticleIdByUrl` + `addUrlToArticle` (the `article_urls` junction table).

**v1 behavior:** keep the detection, drop the merge. Run `SemanticDedup` against recent articles (`GET`-equivalent query: `Article` where `published_at >= now-14d`), and simply **drop** any new article flagged as a duplicate. Do not record the dropped URL anywhere except `scored_url` (so it isn't re-evaluated). This removes the need for the `article_urls` table and the URL→ID lookup. Trade-off: we lose multi-source URL attribution for the same story — acceptable for v1.

---

## Pipeline module layout (`backend/pipeline/`)

```
backend/pipeline/
  __init__.py
  run.py            ← entry point, mirrors run.ts
  steps.py          ← pure helpers: kind_from_url, trust_by_source,
                       github_repo_from_content, SCORE_THRESHOLD, PROMPT_CONTENT_CAP
  utils.py          ← log(), sanitize_llm_text() [regex lib], strip_title_wrappers(), wait()
  crontab           ← supercronic schedule
  sources/
    __init__.py
    utils.py        ← fetch_with_timeout(), is_within_window(), clean_title()
    extract_content.py
    hn.py           [v1]
    ainews.py       [v1]
    substack.py     [v1]
    email.py        [v2]
```

### run.py step mapping

| TS function (run.ts) | Python equivalent | Notes |
|---|---|---|
| `fetchSource` | `fetch_source` | call source fetcher |
| `filterKnownUrls` | `filter_known_urls` | query `article.url` + `scored_url.url` |
| `filterDeadDomains` | `filter_dead_domains` | `dns.resolver` |
| `dedupSemantic` | `dedup_semantic` | `Article` recent query + `SemanticDedup`; **drop dups, no merge** |
| `scoreArticles` | `score_articles` | `ScoreArticles` batch 5; **Ben's Bites +10 bonus, cap 100**; `markUrlsScored` records **all** evaluated URLs |
| `insertArticles` | `insert_articles` | SQLModel insert; dedup-within-batch by URL keeping highest score |
| `improveTitles` | `improve_titles` | `ImproveTitles`, one call per article; skip if source name leaks into title |
| `extractFullContent` | `extract_full_content` | trafilatura; skip `aiNews`/`rss` sourceTypes (their prose is already the summary input) |
| `summarizeAndCategorize` | `summarize_and_categorize` | `SummarizeAndCategorize`, content capped at `PROMPT_CONTENT_CAP=1500`; fallback `CategorizeOnly`+`ClassifyKind`; **blog→repo override** if github repo in content |
| `embedArticles` | `embed_articles` | **model2vec** (drop NVIDIA NIM); text = `title\n\nsummary` |
| `markUrlsScored` | inline in `score_articles` | insert all evaluated URLs into `scored_url` |

---

## Embedding — switch to model2vec (no risk; CORRECTED)

The TS pipeline embedded with NVIDIA NIM `nv-embedqa-e5-v5` (**1024-d**, per the old Turso `F32_BLOB(1024)` schema). The new Postgres schema and **all 786 existing article embeddings are already model2vec `potion-base-8M` (256-d)** — `backend/scripts/import_articles.py` re-embedded everything at import time. So there is **no dimension mismatch and no data migration**: the pipeline just calls model2vec going forward. Reuse the backend's loader (`app.api.routes.articles.get_model` / `_embed`) or load the model once at pipeline start.

---

## Porting hazards (verified against source — implement carefully)

1. **`sanitize_llm_text` unicode regex** (utils.ts:43–59) uses `\p{Emoji_Presentation}` / `\p{Extended_Pictographic}` — Python `re` can't. Use the `regex` library. Applied to titles and summaries.
2. **Concurrency** — `Promise.allSettled` in `hn.py` (≤200 items) and `extract_content.py` → use `asyncio.gather(..., return_exceptions=True)` or a `ThreadPoolExecutor`; one failure must not abort the batch.
3. **Substack** (substack.ts) — retry on Cloudflare 403/429 with backoff, residential proxy **only on retry**, browser-header spoofing. Not "just feedparser".
4. **extract_content** (extract-content.ts) — 28 blocker regexes (paywall/login/JS-required), skip x.com/twitter.com, 5s timeout. `trafilatura` covers most extraction but **test blocker detection on real URLs**; port the skip-list explicitly.
5. **Scored URLs record ALL evaluated** (run.ts:239) — even sub-threshold articles go into `scored_url` so they're never re-scored. Don't filter to passing-only.
6. **Ben's Bites +10 bonus** (run.ts:231, capped 100) — source name must match exactly (`"Ben's Bites"`).
7. **blog→repo override** (run.ts:389) — if kind=blog and `github_repo_from_content` finds a real repo link (steps.ts:32–57, with non-repo-owner filter), set kind=repo.
8. **PROMPT_CONTENT_CAP=1500** — truncate content before `SummarizeAndCategorize`.

---

## Runtime data files to carry over

- `pipeline/sources/substack-sources.json` — 100+ Substack feed URLs. **Copy into `backend/pipeline/sources/`.** (Already in `temp/source/pipeline/sources/`.)
- Newsletter sender list (15 `NEWSLETTER_SOURCES`) is inline in `email.ts` → port into `email.py` constants [v2].

---

## Environment variables (VPS `.env`)

Keep / add to the `pipeline` compose service:
- `DATABASE_URL` (same as backend)
- `NVIDIA_NIM_API_KEY` (BAML LLM calls)
- `RESIDENTIAL_PROXY_URL` (Substack)
- v2: `TAVILY_API_KEY`, `IMAP_HOST`, `IMAP_PORT`, `IMAP_USER`, `IMAP_PASSWORD`

Remove (no longer used anywhere): `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`.

---

## What does NOT change

- `.baml` prompt files — untouched; only add the Python generator
- Frontend / API read endpoints — no change
- GH Actions CI/CD for the FastAPI app — no change
- The old TS `pipeline.yml` in the source repo — disable after the Python pipeline is confirmed stable

---

## Implementation order

### Phase 1 — core + RSS/HN sources
1. Add `ScoredUrl` table to `models_agentique.py` → Alembic migration (no `content` migration — it exists).
2. Add `generator python` to `baml_src/generators.baml`, run `baml generate`, commit `backend/baml_client/`.
3. Add v1 Python deps to `pyproject.toml`; `uv lock`.
4. Port `pipeline/utils.py` + `pipeline/steps.py` (pure helpers — `regex`-based sanitize, kind/github helpers, constants).
5. Port `sources/utils.py` + `sources/extract_content.py` (trafilatura).
6. Port `sources/hn.py` (smoke-test source).
7. Port `sources/ainews.py` + `sources/substack.py` (+ copy `substack-sources.json`).
8. Write `pipeline/run.py` wiring steps; dedup = detect-and-drop; embed = model2vec.
9. Add `pipeline` compose service + `crontab` (supercronic). Record `compose.yml` change in `CHANGES.md`.
10. Test locally against the local Docker DB with a `--limit`/dry-run flag; compare output rows to expectations.
11. Deploy; run once manually (`docker compose run --rm pipeline python -m pipeline.run`); monitor.

### Phase 2 — email source
12. Add v2 deps (`tavily-python`, `imapclient`, `mail-parser`).
13. Port `sources/email.py`: IMAP fetch w/ backoff → `ExtractProducts` → dedup products → `SelectNotableProducts` → Tavily search (concurrency 5, deny-domains) → `SelectProductLink`.
14. Wire email into `SOURCES` in `run.py`; add IMAP/Tavily env to the compose service.
15. Test, deploy, monitor a real run.

### Cutover
16. Disable the TS `pipeline.yml` in the source repo once stable.
17. Update `CHANGES.md` (new compose service, `ScoredUrl` table, new deps).
18. Remove `temp/source/` once the rewrite is done.
