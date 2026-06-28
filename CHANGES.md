# Upstream merge reference

Changes made on top of `fastapi/full-stack-fastapi-template`. Upstream files are untouched unless noted.

---

## 2026-06-28

| File   | Change                                                                                    | Conflict risk  |
| ------ | ----------------------------------------------------------------------------------------- | -------------- |
| `.env` | Deleted this file and added to gitignore. In upstream it's tracked and used as an example | Low — additive |

## 2026-06-27 (pipeline migration)

| File                     | Change                                                                  | Conflict risk          |
| ------------------------ | ----------------------------------------------------------------------- | ---------------------- |
| `backend/pyproject.toml` | Added `baml-py`, `trafilatura`, `feedparser`, `dnspython`, `regex` deps | Low — additive         |
| `backend/Dockerfile`     | Install supercronic; COPY baml_client + pipeline into image             | Low — additive         |
| `compose.yml`            | Added `pipeline` service (supercronic, daily 04:00)                     | Low — additive service |

---

## 2026-06-27

| File                      | Change                                            | Conflict risk           |
| ------------------------- | ------------------------------------------------- | ----------------------- |
| `compose.yml`             | db image `postgres:18` → `pgvector/pgvector:pg17` | Low — one line          |
| `backend/pyproject.toml`  | Added `pgvector`, `model2vec` deps                | Low — additive          |
| `backend/app/api/main.py` | Added `articles` router (items router kept)       | Low — one additive line |
