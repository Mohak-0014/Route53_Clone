"""Application settings, read from environment variables with demo-friendly defaults."""
import os


def _split(value: str) -> list[str]:
    return [v.strip() for v in value.split(",") if v.strip()]


class Settings:
    database_url: str = os.getenv("DATABASE_URL", "sqlite:///./route53.db")
    # Comma-separated list of origins allowed to call the API from a browser.
    cors_origins: list[str] = _split(
        os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
    )
    # Optional regex (e.g. for Vercel preview URLs: https://.*\.vercel\.app)
    cors_origin_regex: str | None = os.getenv("CORS_ORIGIN_REGEX") or None
    session_ttl_hours: int = int(os.getenv("SESSION_TTL_HOURS", "168"))
    # Mock-auth demo account. Override in production-like deployments.
    demo_account_id: str = os.getenv("DEMO_ACCOUNT_ID", "123456789012")
    demo_username: str = os.getenv("DEMO_USERNAME", "demo")
    demo_password: str = os.getenv("DEMO_PASSWORD", "demo1234")
    # Second mock IAM user with read-only access (same account).
    viewer_username: str = "viewer"
    viewer_password: str = os.getenv("VIEWER_PASSWORD", "viewer1234")
    # Seconds a change stays PENDING before it reports INSYNC (simulated propagation).
    propagation_seconds: int = int(os.getenv("PROPAGATION_SECONDS", "10"))
    seed_demo_data: bool = os.getenv("SEED_DEMO_DATA", "true").lower() == "true"


settings = Settings()
