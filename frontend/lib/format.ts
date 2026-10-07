import type { RecordType } from "@/types";

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
}

/** Descriptions shown in the Route 53 record-type selector. */
export const RECORD_TYPE_INFO: Record<
  RecordType,
  { description: string; placeholder: string; hint: string }
> = {
  A: {
    description: "Routes traffic to an IPv4 address and some AWS resources",
    placeholder: "192.0.2.235",
    hint: "IPv4 address. Enter multiple addresses on separate lines.",
  },
  AAAA: {
    description: "Routes traffic to an IPv6 address and some AWS resources",
    placeholder: "2001:0db8:85a3:0:0:8a2e:0370:7334",
    hint: "IPv6 address. Enter multiple addresses on separate lines.",
  },
  CAA: {
    description: "Restricts CAs that can create SSL/TLS certifications for the domain",
    placeholder: '0 issue "amazon.com"',
    hint: 'Format: flags tag "value". Enter multiple values on separate lines.',
  },
  CNAME: {
    description: "Routes traffic to another domain name and to some AWS resources",
    placeholder: "www.example.com",
    hint: "The domain name that you want to resolve to instead of the value in Record name.",
  },
  MX: {
    description: "Specifies mail servers",
    placeholder: "10 mailserver.example.com",
    hint: "Format: priority mail-server. Enter multiple values on separate lines.",
  },
  NS: {
    description: "Identifies the name servers for the hosted zone",
    placeholder: "ns-1.awsdns-1.com",
    hint: "Name server domain names. Enter multiple values on separate lines.",
  },
  PTR: {
    description: "Maps an IP address to a domain name",
    placeholder: "hostname.example.com",
    hint: "The domain name that you want to return.",
  },
  SRV: {
    description: "Application-specific values that identify servers",
    placeholder: "1 10 5269 xmpp-server.example.com",
    hint: "Format: priority weight port target. Enter multiple values on separate lines.",
  },
  TXT: {
    description: "Verifies email senders and application-specific values",
    placeholder: '"Sample text entries"',
    hint: "Enclose text in quotation marks. Enter multiple values on separate lines.",
  },
  SOA: {
    description: "Start of authority record",
    placeholder: "ns-2048.awsdns-64.net. hostmaster.example.com. 1 7200 900 1209600 86400",
    hint: "Seven fields: primary name server, admin email, serial, refresh, retry, expire, minimum TTL.",
  },
};

export function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
