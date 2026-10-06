import secrets
import string
from datetime import datetime, timezone

_ID_ALPHABET = string.ascii_uppercase + string.digits


def utcnow() -> datetime:
    # Stored as naive UTC because SQLite has no timezone type.
    return datetime.now(timezone.utc).replace(tzinfo=None)


def like_pattern(search: str) -> str:
    """Case-insensitive substring pattern for ILIKE ... ESCAPE '\\', treating % and _ literally."""
    escaped = search.strip().lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def generate_id(prefix: str, length: int) -> str:
    """Route 53 style identifiers, e.g. Z0712345ABCDEFGHIJKLM."""
    return prefix + "".join(secrets.choice(_ID_ALPHABET) for _ in range(length))
