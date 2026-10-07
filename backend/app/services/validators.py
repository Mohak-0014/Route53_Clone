"""DNS name and record-value validation, per Route 53's value formats."""
import ipaddress
import re

SUPPORTED_RECORD_TYPES = ["A", "AAAA", "CAA", "CNAME", "MX", "NS", "PTR", "SRV", "TXT"]
# SOA exists in every zone but cannot be created by users.
ALL_RECORD_TYPES = SUPPORTED_RECORD_TYPES + ["SOA"]

_LABEL = re.compile(r"^(?!-)[a-z0-9_-]{1,63}(?<!-)$")
_CAA_TAGS = {"issue", "issuewild", "iodef", "issuemail"}


def normalize_domain(name: str) -> str:
    return name.strip().lower().rstrip(".")


def is_valid_domain(name: str, allow_wildcard: bool = False) -> bool:
    name = normalize_domain(name)
    if not name or len(name) > 253:
        return False
    labels = name.split(".")
    for i, label in enumerate(labels):
        if allow_wildcard and i == 0 and label == "*":
            continue
        if not _LABEL.match(label):
            return False
    return True


def validate_zone_name(name: str) -> str:
    normalized = normalize_domain(name)
    if not is_valid_domain(normalized) or "." not in normalized:
        raise ValueError(
            "Enter a valid domain name, such as example.com. "
            "Use letters a-z, digits 0-9, hyphens and periods."
        )
    return normalized


def resolve_record_name(raw: str, zone_name: str) -> str:
    """Turn the console's 'Record name' input (a subdomain prefix) into an FQDN."""
    raw = normalize_domain(raw)
    if raw in ("", "@"):
        return zone_name
    if raw == zone_name or raw.endswith("." + zone_name):
        fqdn = raw
    else:
        fqdn = f"{raw}.{zone_name}"
    if not is_valid_domain(fqdn, allow_wildcard=True):
        raise ValueError(
            "Record name can contain only letters a-z, digits 0-9, hyphens, underscores "
            "and periods, and may start with '*.' for a wildcard record."
        )
    return fqdn


MAX_TTL = 2147483647
_TTL_UNITS = {"s": 1, "m": 60, "h": 3600, "d": 86400, "w": 604800}
_TTL_RE = re.compile(r"^(?:\d+[smhdw])+$")


def parse_ttl(token: str) -> int | None:
    """Parse a BIND TTL: plain seconds ("3600") or unit form ("1h", "1h30m", "2W").

    Returns None if the token isn't a TTL or is outside Route 53's 0..2147483647 range.
    """
    t = token.strip().lower()
    if t.isdigit():
        seconds = int(t)
    elif _TTL_RE.match(t):
        seconds = sum(int(n) * _TTL_UNITS[u] for n, u in re.findall(r"(\d+)([smhdw])", t))
    else:
        return None
    return seconds if seconds <= MAX_TTL else None


def _hostname(value: str, what: str) -> str:
    """Validate a host name value and store it in canonical form: lowercase, no trailing dot."""
    v = value.strip()
    if not is_valid_domain(v):
        raise ValueError(f"{what} '{value}' is not a valid domain name.")
    return normalize_domain(v)


def _int_in(value: str, low: int, high: int, what: str) -> int:
    try:
        n = int(value)
    except ValueError:
        raise ValueError(f"{what} must be an integer between {low} and {high}.") from None
    if not low <= n <= high:
        raise ValueError(f"{what} must be an integer between {low} and {high}.")
    return n


def _validate_txt(v: str) -> str:
    # Route 53 requires TXT strings to be quoted; quote bare values for convenience.
    if not (v.startswith('"') and v.endswith('"') and len(v) >= 2):
        v = '"' + v.replace('"', '\\"') + '"'
    for chunk in re.findall(r'"((?:[^"\\]|\\.)*)"', v):
        if len(chunk) > 255:
            raise ValueError("Each TXT string must be 255 characters or fewer.")
    return v


def validate_value(record_type: str, value: str) -> str:
    v = value.strip()
    if not v:
        raise ValueError("Value cannot be empty.")
    t = record_type
    if t == "A":
        try:
            ipaddress.IPv4Address(v)
        except ValueError:
            raise ValueError(f"'{v}' is not a valid IPv4 address, e.g. 192.0.2.235.") from None
        return v
    if t == "AAAA":
        try:
            ipaddress.IPv6Address(v)
        except ValueError:
            raise ValueError(
                f"'{v}' is not a valid IPv6 address, e.g. 2001:0db8:85a3::8a2e:0370:7334."
            ) from None
        return v
    if t in ("CNAME", "NS", "PTR"):
        return _hostname(v, "Domain name")
    if t == "MX":
        parts = v.split()
        if len(parts) != 2:
            raise ValueError("MX values use the format 'priority mail-server', e.g. 10 mail.example.com.")
        _int_in(parts[0], 0, 65535, "MX priority")
        return f"{int(parts[0])} {_hostname(parts[1], 'Mail server')}"
    if t == "SRV":
        parts = v.split()
        if len(parts) != 4:
            raise ValueError(
                "SRV values use the format 'priority weight port target', "
                "e.g. 1 10 5269 xmpp-server.example.com."
            )
        _int_in(parts[0], 0, 65535, "SRV priority")
        _int_in(parts[1], 0, 65535, "SRV weight")
        _int_in(parts[2], 0, 65535, "SRV port")
        target = _hostname(parts[3], "SRV target")
        return " ".join(str(int(p)) for p in parts[:3]) + " " + target
    if t == "CAA":
        m = re.match(r'^(\d+)\s+([A-Za-z0-9]+)\s+(".*")$', v)
        if not m:
            raise ValueError('CAA values use the format \'flags tag "value"\', e.g. 0 issue "amazon.com".')
        _int_in(m.group(1), 0, 255, "CAA flags")
        if m.group(2).lower() not in _CAA_TAGS:
            raise ValueError("CAA tag must be one of: issue, issuewild, iodef, issuemail.")
        return f"{int(m.group(1))} {m.group(2).lower()} {m.group(3)}"
    if t == "TXT":
        return _validate_txt(v)
    if t == "SOA":
        if len(v.split()) != 7:
            raise ValueError("SOA value must contain 7 fields.")
        return v
    raise ValueError(f"Unsupported record type '{record_type}'.")
