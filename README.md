# agentique

AI-powered article aggregation and intelligence feed. Fetches articles from configured sources, scores and deduplicates them with an LLM, extracts full content, summarizes and categorizes each piece, and stores vector embeddings for semantic search.

## How it works

A cron-scheduled pipeline fetches articles from configured sources and runs each batch through a sequence of BAML-powered steps: deduplication, LLM scoring, content extraction, summarization, categorization, and vector embedding. Results are served via a FastAPI REST API and a React frontend.

Docker Compose services:

- `db` — PostgreSQL with pgvector extension
- `backend` — FastAPI app serving the REST API
- `pipeline` — runs the article pipeline on a cron schedule via supercronic
- `frontend` — React app served via Vite
- `adminer` — lightweight web UI for browsing and querying the database directly
- `prestart` — one-shot container that runs DB migrations before the backend starts

## Stack

- [FastAPI](https://fastapi.tiangolo.com) — Python backend API
- [BAML](https://docs.boundaryml.com) — structured LLM function definitions
- [PostgreSQL + pgvector](https://github.com/pgvector/pgvector) — article storage and vector search
- [model2vec](https://github.com/MinishLab/model2vec) — fast static embeddings
- [React](https://react.dev) + [Vite](https://vitejs.dev) + [Tailwind CSS](https://tailwindcss.com) — frontend
- [Docker Compose](https://docs.docker.com/compose/) — local dev and production

## Docs

- [Backend](./backend/README.md)
- [Frontend](./frontend/README.md)
- [Deployment](./deployment.md)
- [Development](./development.md)

## Upstream

Fork of [fastapi/full-stack-fastapi-template](https://github.com/fastapi/full-stack-fastapi-template). See [CHANGES.md](./CHANGES.md) for divergences.
