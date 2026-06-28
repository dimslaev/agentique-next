from datetime import UTC, datetime

import regex


def log(message: str) -> None:
    ts = datetime.now(UTC).isoformat()
    print(f"[{ts}] {message}")


def wait_ms(ms: int) -> None:
    import time
    time.sleep(ms / 1000)


def strip_title_wrappers(text: str) -> str:
    """Remove LLM echo artifacts: leading [Source] tags, numbering, surrounding quotes."""
    s = text.strip()
    s = regex.sub(r'^\[[^\]]+\]\s*', '', s)
    s = regex.sub(r'^\d+\.\s*', '', s)
    pairs = [('"', '"'), ("'", "'"), ("“", "”"), ("‘", "’")]
    for open_, close in pairs:
        if s.startswith(open_) and s.endswith(close) and len(s) >= 2:
            s = s[len(open_):len(s) - len(close)].strip()
            break
    return s


def sanitize_llm_text(text: str) -> str:
    """Strip smart quotes, arrows, emoji, and extra whitespace from LLM output."""
    s = text
    s = regex.sub(r'[‘’‚]', "'", s)
    s = regex.sub(r'[“”„]', '"', s)
    s = regex.sub(r'→', '->', s)
    s = regex.sub(r'←', '<-', s)
    s = regex.sub(r'↔', '<->', s)
    s = regex.sub(r'[–—]', '-', s)
    s = regex.sub(r'…', '...', s)
    s = regex.sub(r'[•‣◦▪▫]', '-', s)
    s = regex.sub(
        r'[\p{Emoji_Presentation}\p{Extended_Pictographic}]️?'
        r'(‍[\p{Emoji_Presentation}\p{Extended_Pictographic}]️?)*',
        '',
        s,
    )
    s = regex.sub(r' {2,}', ' ', s)
    return s.strip()
