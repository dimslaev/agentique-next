# Upstream merge reference

Changes made on top of `fastapi/full-stack-fastapi-template`. Upstream files are untouched unless noted.

---

## 2026-06-30

- `compose.yml` — Added `SHELL=/bin/sh` to pipeline service environment; supercronic was inheriting `SHELL=/bin/zsh` from the host and crashing because zsh is not in the image. Added `NVIDIA_NIM_API_KEY` and `RESIDENTIAL_PROXY_URL` to deploy-production.yml env block so they are passed via compose. Low conflict risk.
- `compose.yml` — Changed pipeline command to `supercronic -no-reap`; without this flag supercronic tries to fork/exec itself as a PID 1 process reaper and crashes immediately. Low conflict risk.
- `backend/pipeline/crontab` — Changed `python` to `/app/.venv/bin/python` so the venv is used regardless of PATH. No conflict risk (new file).
- `.github/workflows/deploy-production.yml` — Added `NVIDIA_NIM_API_KEY` and `RESIDENTIAL_PROXY_URL` to deploy job env block.
- `backend/app/main.py` — Added `newsletter.router` mounted directly on `app` under `/api` (not `/api/v1`, which is reserved for the developer-facing articles API). New file `backend/app/api/routes/newsletter.py` is untouched-pattern (mirrors `articles.py`), `app/api/main.py` was not touched. Low conflict risk (two added lines).
- `backend/pyproject.toml` — Added `resend` dependency for the newsletter subscribe feature (adds contacts to a Resend Audience). Low conflict risk (additive single line).
- `compose.yml` — Added `RESEND_API_KEY`/`RESEND_AUDIENCE_ID` to `prestart` and `backend` service environments. Low conflict risk.
- `.github/workflows/deploy-production.yml` — Added `RESEND_API_KEY`/`RESEND_AUDIENCE_ID` to deploy job env block, mapped from new GitHub secrets that still need to be set manually (see plans/newsletter-page.md). Low conflict risk.

---

## 2026-06-29

- `backend/app/core/config.py` — `ENVIRONMENT` Literal changed from `"local"` to `"development"` (value and default); matching `== "local"` guard updated to `== "development"`. Low conflict risk (one-line change; upstream uses `"local"` as the dev environment name).

---

## 2026-06-28

- `frontend/src/routes/_layout.tsx` — `beforeLoad` auth guard commented out so unauthenticated users reach the layout. Low conflict risk (small, isolated block).
- `frontend/src/routes/_layout/index.tsx` — Dashboard component replaced with `ArticlesList`; `useAuth` import removed. Medium conflict risk if upstream extends Dashboard.

- `.env` — Deleted and added to `.gitignore`. In upstream it's tracked and used as an example.
- `compose.yml` — Frontend Traefik rule changed from `Host(\`dashboard.${DOMAIN}\`)` to `Host(\`${DOMAIN}\`)` so the app is served at the root domain. Added `PROJECT_NAME` to prestart and backend service environments.
- `deploy-production.yml` — Split into build job (GitHub-hosted runner, pushes to ghcr.io) and deploy job (self-hosted runner, pulls and restarts). Added buildx + GHA layer caching. Added all missing compose env vars.
- GitHub secrets — Updated `DOCKER_IMAGE_BACKEND`, `DOCKER_IMAGE_FRONTEND` to ghcr.io URLs; `BACKEND_CORS_ORIGINS` and `FRONTEND_HOST` updated to `https://next.agentique.ch`; added `STACK_NAME_PRODUCTION=agentique-next`.
- `deploy-staging.yml` — Reverted to upstream and disabled (workflow_dispatch only); the VPS has one environment.
- `deploy-production.yml` — Trigger changed from `release: published` to `push: [master]`; added `touch .env` step; added all missing compose env vars (`POSTGRES_USER`, `POSTGRES_DB`, `POSTGRES_PORT`, `POSTGRES_SERVER`, `DOCKER_IMAGE_BACKEND`, `DOCKER_IMAGE_FRONTEND`, `FRONTEND_HOST`, `BACKEND_CORS_ORIGINS`, `BAML_LOG`).

### Disabled upstream CI workflows

Neutered `on:` triggers to `workflow_dispatch` (manual-only). Files and jobs are kept intact;
original triggers are recorded in a comment at the top of each file.
— only the `on:` block changed, easy to revert.

- `add-to-project` — targets the fastapi org project board; needs `PROJECTS_TOKEN` we don't have
- `smokeshow` — uploads coverage badge to smokeshow.com; needs `SMOKESHOW_AUTH_KEY`; redundant with the `--fail-under=90` gate already in Test Backend
- `labeler` — fails PRs that lack an upstream label taxonomy (breaking/security/feature/…)
- `detect-conflicts` — auto-labels conflicting PRs; only useful with many concurrent contributors
- `guard-dependencies` — auto-closes dep PRs from non-org members
- `issue-manager` — gated to `repository_owner == 'fastapi'`; never executed in this fork
- `latest-changes` — tiangolo's changelog bot; needs `LATEST_CHANGES` secret and a `release-notes.md` we don't maintain
- `test-docker-compose` — redundant; Playwright already builds and exercises the full stack

---

## 2026-06-27 — pipeline migration

- `backend/pyproject.toml` — Added `baml-py`, `trafilatura`, `feedparser`, `dnspython`, `regex` deps.
- `backend/Dockerfile` — Install supercronic; COPY `baml_client` + `pipeline` into image.
- `compose.yml` — Added `pipeline` service (supercronic, daily 04:00).

---

## 2026-06-27

- `compose.yml` — db image `postgres:18` → `pgvector/pgvector:pg17`.
- `backend/pyproject.toml` — Added `pgvector`, `model2vec` deps.
- `backend/app/api/main.py` — Added `articles` router (items router kept).
