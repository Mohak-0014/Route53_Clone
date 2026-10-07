"""Database initialization and demo data.

Runs on startup: creates tables if they don't exist, ensures the demo user exists,
and seeds sample hosted zones only when the zones table is empty — so user changes
are never overwritten on restart.

Run manually to reset everything:  python -m app.seed --reset
"""
import sys

from sqlalchemy import Engine, func, select, text

from app.config import settings
from app.database import Base, SessionLocal, engine
from app.models import HostedZone, User
from app.schemas.hosted_zone import HostedZoneCreate
from app.schemas.record import RecordCreate
from app.services import record_service, zone_service
from app.services.auth_service import hash_password

DEMO_ZONES: list[dict] = [
    {
        "zone": {"name": "example.com", "comment": "Primary marketing website"},
        "records": [
            ("", "A", 300, ["192.0.2.10", "192.0.2.11"]),
            ("", "AAAA", 300, ["2001:db8::10"]),
            ("", "MX", 3600, ["10 mail1.example.com", "20 mail2.example.com"]),
            ("", "TXT", 300, ['"v=spf1 include:amazonses.com ~all"', '"google-site-verification=a1B2c3D4e5"']),
            ("", "CAA", 3600, ['0 issue "amazon.com"', '0 iodef "mailto:security@example.com"']),
            ("www", "CNAME", 300, ["example.com"]),
            ("api", "A", 60, ["198.51.100.20"]),
            ("mail1", "A", 3600, ["192.0.2.25"]),
            ("mail2", "A", 3600, ["192.0.2.26"]),
            ("blog", "CNAME", 300, ["example-blog.ghost.io"]),
            ("_sip._tcp", "SRV", 600, ["10 60 5060 sip.example.com"]),
            ("sip", "A", 600, ["192.0.2.40"]),
            ("_dmarc", "TXT", 300, ['"v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com"']),
            ("staging", "A", 60, ["203.0.113.5"]),
            ("cdn", "CNAME", 86400, ["d111111abcdef8.cloudfront.net"]),
        ],
    },
    {
        "zone": {"name": "example.org", "comment": "Community site"},
        "records": [
            ("", "A", 300, ["203.0.113.50"]),
            ("www", "CNAME", 300, ["example.org"]),
            ("docs", "CNAME", 300, ["example-org.readthedocs.io"]),
            ("", "TXT", 300, ['"v=spf1 -all"']),
        ],
    },
    {
        "zone": {"name": "mycompany.com", "comment": "Corporate domain - managed by IT"},
        "records": [
            ("", "A", 300, ["198.51.100.1"]),
            ("www", "A", 300, ["198.51.100.1"]),
            ("", "MX", 3600, ["1 aspmx.l.google.com", "5 alt1.aspmx.l.google.com", "10 alt2.aspmx.l.google.com"]),
            ("vpn", "A", 300, ["198.51.100.99"]),
            ("intranet", "CNAME", 300, ["mycompany.sharepoint.com"]),
            ("dev", "NS", 172800, ["ns-101.awsdns-12.com", "ns-1500.awsdns-59.org"]),
            ("", "CAA", 3600, ['0 issue "letsencrypt.org"']),
        ],
    },
    {
        "zone": {"name": "shop-demo.net", "comment": "E-commerce storefront"},
        "records": [
            ("", "A", 60, ["192.0.2.100"]),
            ("www", "CNAME", 60, ["shop-demo.net"]),
            ("checkout", "AAAA", 60, ["2001:db8:85a3::8a2e:370:7334"]),
        ],
    },
    {
        "zone": {"name": "2.0.192.in-addr.arpa", "comment": "Reverse DNS for 192.0.2.0/24"},
        "records": [
            ("10", "PTR", 3600, ["example.com"]),
            ("25", "PTR", 3600, ["mail1.example.com"]),
        ],
    },
    {
        "zone": {
            "name": "internal.mycompany.com",
            "comment": "Private zone for internal services",
            "type": "private",
            "vpc_region": "ap-south-1",
            "vpc_id": "vpc-0a1b2c3d4e5f67890",
        },
        "records": [
            ("db", "A", 60, ["10.0.1.15"]),
            ("cache", "A", 60, ["10.0.1.30"]),
            ("jenkins", "CNAME", 300, ["ip-10-0-2-12.ap-south-1.compute.internal"]),
        ],
    },
]


# Columns added after the first release: (table, column, DDL). create_all only creates
# missing tables, so existing database files get these through ALTER TABLE.
_ADDED_COLUMNS = [
    ("resource_record_sets", "version", "INTEGER NOT NULL DEFAULT 1"),
    ("users", "role", "TEXT NOT NULL DEFAULT 'admin'"),
]


def migrate(bind: Engine) -> None:
    """Idempotently add columns that older database files are missing."""
    with bind.begin() as conn:
        for table, column, ddl in _ADDED_COLUMNS:
            existing = {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))}
            if existing and column not in existing:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    migrate(engine)
    with SessionLocal() as db:
        # Mock IAM users: an administrator and a read-only user in the same account.
        for username, password, role in (
            (settings.demo_username, settings.demo_password, "admin"),
            (settings.viewer_username, settings.viewer_password, "read_only"),
        ):
            if db.scalar(select(User).where(User.username == username)) is None:
                db.add(
                    User(
                        account_id=settings.demo_account_id,
                        username=username,
                        password_hash=hash_password(password),
                        role=role,
                    )
                )
        db.commit()

        if settings.seed_demo_data and not db.scalar(select(func.count()).select_from(HostedZone)):
            for spec in DEMO_ZONES:
                zone = zone_service.create_zone(db, HostedZoneCreate(**spec["zone"]))
                for name, rtype, ttl, values in spec["records"]:
                    record_service.create_record(
                        db, zone.id, RecordCreate(name=name, type=rtype, ttl=ttl, values=values)
                    )


if __name__ == "__main__":
    if "--reset" in sys.argv:
        Base.metadata.drop_all(bind=engine)
    init_db()
    print("Database initialized.")
