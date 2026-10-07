"""Alembic environment: runs revisions against app.config.settings.database_url.

Used both by the CLI (python -m alembic ...) and by app.db_migrations.upgrade_database(),
which the API calls on startup.
"""
from logging.config import fileConfig

from alembic import context

import app.models  # noqa: F401  (registers every table on Base.metadata)
from app.config import settings
from app.database import Base
from app.db_migrations import migration_engine

config = context.config
if config.config_file_name and config.attributes.get("configure_logging", True):
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _url() -> str:
    return config.get_main_option("sqlalchemy.url") or settings.database_url


def run_migrations_offline() -> None:
    context.configure(
        url=_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        render_as_batch=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = migration_engine(_url())
    try:
        with engine.connect() as connection:
            context.configure(
                connection=connection,
                target_metadata=target_metadata,
                # SQLite can't add or drop constraints with ALTER TABLE; batch mode rebuilds the table.
                render_as_batch=True,
                # migration_engine makes SQLite DDL transactional: the whole upgrade commits or none of it.
                transactional_ddl=True,
            )
            with context.begin_transaction():
                context.run_migrations()
                if connection.dialect.name == "sqlite":
                    broken = connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall()
                    if broken:
                        raise RuntimeError(f"Migration left rows with broken foreign keys: {broken[:5]}")
    finally:
        engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
