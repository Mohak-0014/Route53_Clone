"""BIND zone-file import/export and JSON export (bonus features)."""
import re
import shlex

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import HostedZone, ResourceRecordSet
from app.services.validators import SUPPORTED_RECORD_TYPES, normalize_domain, validate_value
from app.schemas.change import ChangeInfo
from app.services import change_service
from app.services.zone_service import get_zone

_HOST_VALUE_TYPES = {"CNAME", "NS", "PTR"}
_CLASSES = {"IN", "CH", "HS"}


def _absolute(host: str) -> str:
    return host if host.endswith(".") else host + "."


def _export_value(record_type: str, value: str) -> str:
    if record_type in _HOST_VALUE_TYPES:
        return _absolute(value)
    if record_type == "MX":
        prio, host = value.split()
        return f"{prio} {_absolute(host)}"
    if record_type == "SRV":
        *nums, target = value.split()
        return " ".join(nums + [_absolute(target)])
    return value


def export_bind(db: Session, zone_id: str) -> tuple[HostedZone, str]:
    zone = get_zone(db, zone_id)
    records = db.scalars(
        select(ResourceRecordSet)
        .where(ResourceRecordSet.hosted_zone_id == zone.id)
        .order_by(ResourceRecordSet.name, ResourceRecordSet.record_type)
    ).all()
    lines = [
        f";; Zone: {zone.name}  (hosted zone ID {zone.id})",
        ";; Exported from Route 53 clone",
        f"$ORIGIN {zone.name}.",
        "",
    ]
    for r in sorted(records, key=lambda r: (r.name != zone.name, r.record_type != "SOA", r.name)):
        for v in r.values:
            lines.append(f"{r.name}.\t{r.ttl}\tIN\t{r.record_type}\t{_export_value(r.record_type, v)}")
    return zone, "\n".join(lines) + "\n"


def export_json(db: Session, zone_id: str) -> dict:
    zone = get_zone(db, zone_id)
    records = db.scalars(
        select(ResourceRecordSet).where(ResourceRecordSet.hosted_zone_id == zone.id)
    ).all()
    return {
        "HostedZone": {
            "Id": f"/hostedzone/{zone.id}",
            "Name": f"{zone.name}.",
            "Config": {"Comment": zone.comment, "PrivateZone": zone.zone_type == "private"},
        },
        "ResourceRecordSets": [
            {
                "Name": f"{r.name}.",
                "Type": r.record_type,
                "TTL": r.ttl,
                "ResourceRecords": [{"Value": v} for v in r.values],
            }
            for r in records
        ],
    }


def _strip_comment(line: str) -> str:
    out, in_quote = [], False
    for ch in line:
        if ch == '"':
            in_quote = not in_quote
        if ch == ";" and not in_quote:
            break
        out.append(ch)
    return "".join(out)


def _join_parentheses(text: str) -> list[str]:
    """Collapse multi-line ( ... ) groups (used by SOA) into single logical lines."""
    lines, buf, depth = [], "", 0
    for raw in text.splitlines():
        line = _strip_comment(raw)
        depth += line.count("(") - line.count(")")
        buf += " " + line.replace("(", " ").replace(")", " ") if buf else line.replace("(", " ").replace(")", " ")
        if depth <= 0:
            lines.append(buf)
            buf, depth = "", 0
    if buf:
        lines.append(buf)
    return lines


def _qualify(name: str, origin: str) -> str:
    if name == "@":
        return origin
    if name.endswith("."):
        return normalize_domain(name)
    return f"{normalize_domain(name)}.{origin}" if origin else normalize_domain(name)


def import_bind(
    db: Session, zone_id: str, text: str, actor: str | None = None
) -> tuple[int, int, list[str], ChangeInfo | None]:
    zone = get_zone(db, zone_id)
    origin, default_ttl, last_name = zone.name, 300, zone.name
    grouped: dict[tuple[str, str], dict] = {}
    errors: list[str] = []

    for lineno, line in enumerate(_join_parentheses(text), start=1):
        if not line.strip():
            continue
        starts_blank = line[0] in " \t"
        try:
            tokens = shlex.split(line, posix=False)
        except ValueError:
            errors.append(f"Line {lineno}: could not parse quoted text.")
            continue
        if tokens[0].upper() == "$ORIGIN":
            origin = normalize_domain(tokens[1])
            continue
        if tokens[0].upper() == "$TTL":
            default_ttl = int(re.sub(r"\D", "", tokens[1]) or 300)
            continue
        if tokens[0].startswith("$"):
            continue

        if not starts_blank:
            last_name = _qualify(tokens.pop(0), origin)
        ttl = default_ttl
        rtype = None
        while tokens:
            tok = tokens[0]
            if tok.isdigit():
                ttl = int(tokens.pop(0))
            elif tok.upper() in _CLASSES:
                tokens.pop(0)
            else:
                rtype = tokens.pop(0).upper()
                break
        if rtype is None or not tokens:
            errors.append(f"Line {lineno}: missing record type or value.")
            continue
        if rtype == "SOA" or (rtype == "NS" and last_name == zone.name):
            continue  # Route 53 keeps its own apex SOA/NS, as the real import does
        if rtype not in SUPPORTED_RECORD_TYPES:
            errors.append(f"Line {lineno}: record type {rtype} is not supported.")
            continue
        if last_name != zone.name and not last_name.endswith("." + zone.name):
            errors.append(f"Line {lineno}: {last_name} is not in zone {zone.name}.")
            continue

        value_tokens = tokens
        if rtype in _HOST_VALUE_TYPES:
            value_tokens = [_qualify(tokens[0], origin)]
        elif rtype == "MX" and len(tokens) == 2:
            value_tokens = [tokens[0], _qualify(tokens[1], origin)]
        elif rtype == "SRV" and len(tokens) == 4:
            value_tokens = tokens[:3] + [_qualify(tokens[3], origin)]
        try:
            value = validate_value(rtype, " ".join(value_tokens))
        except ValueError as e:
            errors.append(f"Line {lineno}: {e}")
            continue

        entry = grouped.setdefault((last_name, rtype), {"ttl": ttl, "values": []})
        if value not in entry["values"]:
            entry["values"].append(value)

    existing = {
        (r.name, r.record_type)
        for r in db.scalars(
            select(ResourceRecordSet).where(ResourceRecordSet.hosted_zone_id == zone.id)
        )
    }
    all_keys = existing | set(grouped)
    created = skipped = 0
    for (name, rtype), entry in grouped.items():
        if (name, rtype) in existing:
            skipped += 1
            errors.append(f"Skipped {name} {rtype}: a record with this name and type already exists.")
            continue
        others = {t for (n, t) in all_keys if n == name and t != rtype}
        if (rtype == "CNAME" and others) or (rtype != "CNAME" and "CNAME" in others) or (
            rtype == "CNAME" and (name == zone.name or len(entry["values"]) > 1)
        ):
            skipped += 1
            errors.append(f"Skipped {name} {rtype}: conflicts with CNAME rules.")
            continue
        db.add(
            ResourceRecordSet(
                hosted_zone_id=zone.id, name=name, record_type=rtype, ttl=entry["ttl"], values=entry["values"]
            )
        )
        created += 1
    change = None
    if actor is not None and created:
        noun = "record" if created == 1 else "records"
        change = change_service.add(db, zone.id, "IMPORT", f"{created} {noun}", None, actor)
    db.commit()
    return created, skipped, errors, change_service.to_info(change) if change else None
