"""
One-time migration: import articles from articles-export.json into Postgres,
re-embedding each article (title + summary) with model2vec potion-base-8M.

Usage (from repo root, with .env sourced or DATABASE_URL set):
    uv run python backend/scripts/import_articles.py [path/to/articles-export.json]

Default input path: articles-export.json (repo root).
"""
import json
import sys
from datetime import datetime
from pathlib import Path

import numpy as np
from model2vec import StaticModel
from sqlmodel import Session, create_engine

# Allow running from repo root without installing the package
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.core.config import settings  # noqa: E402
from app.models_articles import Article  # noqa: E402

EXPORT_PATH = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("articles-export.json")
BATCH_SIZE = 64


def parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def embed_batch(model: StaticModel, texts: list[str]) -> list[list[float]]:
    vecs = model.encode(texts)
    norms = np.linalg.norm(vecs, axis=1, keepdims=True)
    norms = np.where(norms == 0, 1, norms)
    return (vecs / norms).tolist()


def main() -> None:
    if not EXPORT_PATH.exists():
        print(f"Export file not found: {EXPORT_PATH}")
        sys.exit(1)

    raw = json.loads(EXPORT_PATH.read_text())
    print(f"Loaded {len(raw)} articles from {EXPORT_PATH}")

    print("Loading model2vec model (minishlab/potion-base-8M)…")
    model = StaticModel.from_pretrained("minishlab/potion-base-8M")

    engine = create_engine(str(settings.SQLALCHEMY_DATABASE_URI))

    inserted = skipped = embedded = 0

    with Session(engine) as session:
        # Process in batches for embedding efficiency
        embeddable = [
            r for r in raw if r.get("score") is not None and r.get("summary")
        ]
        non_embeddable = [
            r for r in raw if not (r.get("score") is not None and r.get("summary"))
        ]

        # Build embedding map: id → vector
        embedding_map: dict[int, list[float]] = {}
        for i in range(0, len(embeddable), BATCH_SIZE):
            batch = embeddable[i : i + BATCH_SIZE]
            texts = [f"{r['title']}\n{r['summary']}" for r in batch]
            vecs = embed_batch(model, texts)
            for r, vec in zip(batch, vecs):
                embedding_map[r["id"]] = vec
            embedded += len(batch)
            print(f"  embedded {embedded}/{len(embeddable)}", end="\r")

        print(f"\nEmbedded {embedded} articles, skipping {len(non_embeddable)} (no summary)")

        all_rows = embeddable + non_embeddable
        for row in all_rows:
            article = Article(
                title=row["title"],
                source=row["source"],
                source_type=row["source_type"],
                url=row.get("url"),
                published_at=parse_dt(row.get("published_at")),
                score=row.get("score"),
                summary=row.get("summary"),
                categories=row.get("categories") or [],
                kind=row.get("kind"),
                content=row.get("content") or "",
                embedding=embedding_map.get(row["id"]),
                created_at=parse_dt(row.get("created_at")),
            )
            session.add(article)
            inserted += 1

        session.commit()

    print(f"Done. Inserted {inserted} articles ({embedded} with embeddings, {skipped} skipped).")


if __name__ == "__main__":
    main()
