"""Route 53's "Test record" (TestDNSAnswer): simulate the response for a DNS query.

Resolution runs entirely against the records stored in one hosted zone:
  1. names outside the zone are rejected;
  2. a non-apex NS record at or above the name is a delegation (referral);
  3. an exact (name, type) match answers with its values;
  4. a CNAME at the name is returned and its target chased inside the zone;
  5. a name with no records (and none below it) may match a wildcard *.ancestor;
  6. a name that exists without the requested type is NODATA;
  7. anything else is NXDOMAIN.
"""
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models import HostedZone, ResourceRecordSet
from app.schemas.dns_test import ResourceRecordOut, TestRecordResult
from app.services.validators import normalize_domain, resolve_record_name
from app.services.zone_service import get_zone

MAX_CNAME_HOPS = 8


def _invalid(message: str) -> AppError:
    return AppError(400, "InvalidInput", message)


def _query_name(raw: str, zone_name: str) -> str:
    """Resolve the console input like the record form; a trailing dot marks a fully qualified name."""
    absolute = raw.strip().endswith(".") and raw.strip() not in (".", "@.")
    try:
        fqdn = resolve_record_name(raw, zone_name)
    except ValueError as e:
        raise _invalid(str(e)) from None
    if absolute and fqdn != normalize_domain(raw):
        raise _invalid(f"{normalize_domain(raw)} is not in the hosted zone {zone_name}.")
    return fqdn


@dataclass
class _Resolver:
    zone: HostedZone
    by_name: dict[str, dict[str, ResourceRecordSet]]
    answers: list[ResourceRecordOut] = field(default_factory=list)
    authority: list[ResourceRecordOut] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def rrs(self, rec: ResourceRecordSet, owner: str | None = None) -> list[ResourceRecordOut]:
        return [
            ResourceRecordOut(name=owner or rec.name, type=rec.record_type, ttl=rec.ttl, value=v)
            for v in rec.values
        ]

    def soa_authority(self) -> None:
        soa = self.by_name.get(self.zone.name, {}).get("SOA")
        self.authority = self.rrs(soa) if soa else []

    def in_zone(self, name: str) -> bool:
        return name == self.zone.name or name.endswith("." + self.zone.name)

    def ancestors(self, name: str) -> list[str]:
        """Names from just above `name` up to and including the apex, closest first."""
        out, current = [], name
        while current != self.zone.name and "." in current:
            current = current.split(".", 1)[1]
            out.append(current)
            if current == self.zone.name:
                break
        return out

    def exists(self, name: str) -> bool:
        """A name exists if it owns records or has records below it (an empty non-terminal)."""
        return name in self.by_name or any(n.endswith("." + name) for n in self.by_name)

    def delegation(self, name: str, qtype: str) -> str | None:
        # The cut nearest the apex wins: that is where the parent zone stops answering.
        for cut in reversed([name, *self.ancestors(name)]):
            if cut == self.zone.name:
                continue
            if "NS" in self.by_name.get(cut, {}) and not (cut == name and qtype == "NS"):
                return cut
        return None

    def resolve(self, name: str, qtype: str, visited: set[str]) -> str:
        cut = self.delegation(name, qtype)
        if cut:
            self.authority = self.rrs(self.by_name[cut]["NS"])
            self.notes.append(f"Delegated to a subdomain: {cut} has its own name servers.")
            return "NOERROR"

        records, owner = self.by_name.get(name), name
        if records is None and not self.exists(name):
            for parent in self.ancestors(name):
                wildcard = f"*.{parent}"
                if wildcard in self.by_name:
                    records = self.by_name[wildcard]
                    self.notes.append(f"Answered by the wildcard record {wildcard}.")
                    break
        if records is None:
            if not self.exists(name):
                self.soa_authority()
                return "NXDOMAIN"
            records = {}

        if qtype in records:
            self.answers += self.rrs(records[qtype], owner)
            return "NOERROR"

        if "CNAME" in records and qtype != "CNAME":
            cname = records["CNAME"]
            self.answers += self.rrs(cname, owner)
            target = normalize_domain(cname.values[0])
            if target in visited:
                self.notes.append(f"CNAME loop detected at {target}; resolution stopped.")
                return "NOERROR"
            if len(visited) >= MAX_CNAME_HOPS:
                self.notes.append(f"Stopped after {MAX_CNAME_HOPS} CNAME hops.")
                return "NOERROR"
            if not self.in_zone(target):
                self.notes.append(
                    f"The CNAME target {target} is outside this hosted zone; "
                    "a DNS resolver would continue the lookup there."
                )
                return "NOERROR"
            return self.resolve(target, qtype, visited | {target})

        # The name exists but has no record of this type: NODATA.
        self.soa_authority()
        return "NOERROR"


def answer_query(db: Session, zone_id: str, record_name: str, record_type: str) -> TestRecordResult:
    zone = get_zone(db, zone_id)
    qname = _query_name(record_name, zone.name)

    by_name: dict[str, dict[str, ResourceRecordSet]] = {}
    for rec in db.scalars(select(ResourceRecordSet).where(ResourceRecordSet.hosted_zone_id == zone.id)):
        by_name.setdefault(rec.name, {})[rec.record_type] = rec

    resolver = _Resolver(zone=zone, by_name=by_name)
    code = resolver.resolve(qname, record_type, {qname})
    return TestRecordResult(
        query_name=qname,
        query_type=record_type,
        response_code=code,
        protocol="UDP",
        answers=resolver.answers,
        authority=resolver.authority,
        notes=resolver.notes,
    )
