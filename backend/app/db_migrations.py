"""Schema migrations with Alembic (revisions in backend/migrations/versions).

The API applies them on startup through upgrade_database(), because the hosted backend only
runs uvicorn. Database files created before Alembic was introduced have the app tables but no
alembic_version table; they are first brought to the baseline revision's shape, then upgraded.
"""
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import Engine, String, create_engine, event, inspect

from app.config import settings
from app.database import Base, engine as app_engine

BACKEND_DIR = Path(__file__).resolve().parent.parent
BASELINE_REVISION = "0001"
APP_TABLES = {"users", "sessions", "hosted_zones", "resource_record_sets", "changes"}

# Columns the pre-Alembic startup migration used to add with ALTER TABLE, with the baseline's
# definitions. Files that never got them receive them here before the baseline is recorded.
_BASELINE_ADDED_COLUMNS = [
    ("resource_record_sets", "version", "INTEGER DEFAULT '1' NOT NULL"),
    ("users", "role", "VARCHAR(16) DEFAULT 'admin' NOT NULL"),
]


def migration_engine(url: str) -> Engine:
    """An engine for running migrations (not the app's engine).

    SQLite changes constraints by rebuilding a table (create a copy, copy the rows, drop the
    original, rename). Foreign keys must be off while that happens, or dropping hosted_zones
    would cascade-delete every record and change. env.py runs PRAGMA foreign_key_check before
    committing instead. SQLAlchemy also emits BEGIN itself, so DDL is transactional and a failed
    upgrade rolls back completely.
    """
    eng = create_engine(url)
    if url.startswith("sqlite"):

        @event.listens_for(eng, "connect")
        def _connect(dbapi_connection, _record) -> None:
            dbapi_connection.isolation_level = None
            dbapi_connection.execute("PRAGMA foreign_keys=OFF")

        @event.listens_for(eng, "begin")
        def _begin(conn) -> None:
            conn.exec_driver_sql("BEGIN")

    return eng


def alembic_config(url: str | None = None) -> Config:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    cfg.set_main_option("sqlalchemy.url", (url or settings.database_url).replace("%", "%%"))
    cfg.attributes["configure_logging"] = False  # keep the server's logging setup
    return cfg


def _adopt_pre_alembic_database(url: str) -> bool:
    """Give a pre-Alembic file the baseline's columns. Returns True if it is one.

    Missing columns are added. The old startup migration added users.role as TEXT; it is
    rebuilt as the baseline's VARCHAR(16) (Alembic batch mode, rows copied).
    """
    eng = migration_engine(url)
    try:
        with eng.begin() as conn:
            tables = set(inspect(conn).get_table_names())
            if "alembic_version" in tables or not tables & APP_TABLES:
                return False
            for table, column, ddl in _BASELINE_ADDED_COLUMNS:
                if table in tables and column not in {c["name"] for c in inspect(conn).get_columns(table)}:
                    conn.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")
            if "users" in tables:
                role = next(c for c in inspect(conn).get_columns("users") if c["name"] == "role")
                if str(role["type"]) != "VARCHAR(16)":
                    ops = Operations(MigrationContext.configure(conn))
                    with ops.batch_alter_table("users", recreate="always") as batch:
                        batch.alter_column(
                            "role", type_=String(16), existing_nullable=False, existing_server_default="admin"
                        )
        return True
    finally:
        eng.dispose()


def upgrade_database(url: str | None = None) -> None:
    """Bring the database to the latest revision ("alembic upgrade head")."""
    url = url or settings.database_url
    cfg = alembic_config(url)
    if _adopt_pre_alembic_database(url):
        # The baseline creates only what is missing (tables such as `changes` that the oldest
        # files predate, and their indexes), then records the file as being at the baseline.
        command.upgrade(cfg, BASELINE_REVISION)
    command.upgrade(cfg, "head")


def reset_database() -> None:
    """Drop every table, including Alembic's version table (python -m app.seed --reset)."""
    Base.metadata.drop_all(bind=app_engine)
    with app_engine.begin() as conn:
        conn.exec_driver_sql("DROP TABLE IF EXISTS alembic_version")
