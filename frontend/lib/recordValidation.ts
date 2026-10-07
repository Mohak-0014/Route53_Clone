import type { RecordType } from "@/types";

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const HOST = /^(\*\.)?([a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?\.)*[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?\.?$/i;
const NAME_PREFIX = /^(\*|[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?)(\.[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?)*$/i;

function isIPv6(v: string) {
  if (!v.includes(":") || /[^0-9a-f:.]/i.test(v)) return false;
  const doubleColons = v.split("::").length - 1;
  if (doubleColons > 1) return false;
  const groups = v.split(":").filter(Boolean);
  return doubleColons ? groups.length < 8 : groups.length === 8;
}

const int = (s: string, max: number) => /^\d+$/.test(s) && Number(s) <= max;

/**
 * Quick client-side checks so obvious mistakes are flagged before submit.
 * The API performs the authoritative validation.
 */
export function validateValueLine(type: RecordType, raw: string): string | null {
  const v = raw.trim();
  const parts = v.split(/\s+/);
  switch (type) {
    case "A":
      return IPV4.test(v) ? null : `"${v}" is not a valid IPv4 address.`;
    case "AAAA":
      return isIPv6(v) ? null : `"${v}" is not a valid IPv6 address.`;
    case "CNAME":
    case "NS":
    case "PTR":
      return HOST.test(v) ? null : `"${v}" is not a valid domain name.`;
    case "MX":
      return parts.length === 2 && int(parts[0], 65535) && HOST.test(parts[1])
        ? null
        : `"${v}" must use the format: priority mail-server (e.g. 10 mail.example.com).`;
    case "SRV":
      return parts.length === 4 && parts.slice(0, 3).every((p) => int(p, 65535)) && HOST.test(parts[3])
        ? null
        : `"${v}" must use the format: priority weight port target.`;
    case "CAA":
      return /^\d{1,3}\s+(issue|issuewild|iodef|issuemail)\s+".*"$/i.test(v)
        ? null
        : `"${v}" must use the format: flags tag "value" (e.g. 0 issue "amazon.com").`;
    default:
      return null;
  }
}

export function validateRecordName(name: string): string | null {
  const n = name.trim().replace(/\.$/, "");
  if (!n || n === "@") return null;
  return NAME_PREFIX.test(n)
    ? null
    : "Record name can contain only a-z, 0-9, hyphens, underscores and periods, and may start with * for a wildcard.";
}
