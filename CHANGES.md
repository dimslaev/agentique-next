# Upstream merge reference

Changes made on top of `fastapi/full-stack-fastapi-template`. Upstream files are untouched unless noted.

---

## 2026-06-28

- `.env` — Deleted and added to `.gitignore`. In upstream it's tracked and used as an example.

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
