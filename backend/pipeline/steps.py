from __future__ import annotations

import re

SCORE_THRESHOLD = 76
PROMPT_CONTENT_CAP = 1500

NON_REPO_OWNERS = {
    "features", "login", "pricing", "about", "marketplace", "explore",
    "topics", "collections", "trending", "sponsors", "orgs", "apps",
    "contact", "security",
}

GITHUB_REPO_RE = re.compile(
    r'https?://(?:www\.)?github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)'
)


def github_repo_from_content(content: str) -> str | None:
    match = GITHUB_REPO_RE.search(content)
    if not match:
        return None
    owner, repo = match.group(1), match.group(2)
    if owner.lower() in NON_REPO_OWNERS:
        return None
    return f"https://github.com/{owner}/{repo}"


def kind_from_url(url: str) -> str | None:
    try:
        from urllib.parse import urlparse
        host = urlparse(url).hostname or ""
        host = host.removeprefix("www.")
        if host in ("github.com", "gitlab.com"):
            return "repo"
        if host in ("huggingface.co", "hf.co"):
            return "model"
        if host in ("arxiv.org", "ar5iv.labs.arxiv.org"):
            return "paper"
    except Exception:
        pass
    return None


TRUST_BY_SOURCE: dict[str, str] = {
    "Hacker News": "high",
    "AI News": "high",
}
