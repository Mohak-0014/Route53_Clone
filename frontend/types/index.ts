export type ZoneType = "public" | "private";

export const RECORD_TYPES = ["A", "AAAA", "CAA", "CNAME", "MX", "NS", "PTR", "SRV", "TXT"] as const;
export type RecordType = (typeof RECORD_TYPES)[number] | "SOA";

export type UserRole = "admin" | "read_only";

export interface User {
  username: string;
  account_id: string;
  role: UserRole;
}

export interface SessionInfo {
  token: string;
  expires_at: string;
  user: User;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface HostedZone {
  id: string;
  name: string;
  type: ZoneType;
  comment: string;
  record_count: number;
  vpc_region: string | null;
  vpc_id: string | null;
  name_servers: string[];
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface HostedZoneInput {
  name: string;
  comment: string;
  type: ZoneType;
  vpc_region?: string | null;
  vpc_id?: string | null;
}

export interface DnsRecord {
  id: string;
  hosted_zone_id: string;
  name: string;
  type: RecordType;
  ttl: number;
  values: string[];
  routing_policy: string;
  alias: boolean;
  comment: string;
  is_default: boolean;
  /** Optimistic-locking counter; send it back as expected_version when updating. */
  version: number;
  created_at: string;
  updated_at: string;
}

export interface DnsRecordInput {
  name: string;
  type: RecordType;
  ttl: number;
  values: string[];
  comment?: string;
  expected_version?: number;
}

export interface ImportResult {
  created: number;
  skipped: number;
  errors: string[];
  change: ChangeInfo | null;
}


export interface ResourceRecordAnswer {
  name: string;
  type: RecordType;
  ttl: number;
  value: string;
}

/** Response of the console's "Test record" (Route 53 TestDNSAnswer). */
export interface TestRecordResult {
  query_name: string;
  query_type: RecordType;
  response_code: "NOERROR" | "NXDOMAIN";
  protocol: "UDP";
  answers: ResourceRecordAnswer[];
  authority: ResourceRecordAnswer[];
  notes: string[];
}

export type ChangeStatus = "PENDING" | "INSYNC";

/** Route 53 ChangeInfo, returned with every record change. */
export interface ChangeInfo {
  id: string;
  status: ChangeStatus;
  submitted_at: string;
}

/** An entry in a hosted zone's change history. */
export interface Change extends ChangeInfo {
  hosted_zone_id: string;
  action: "CREATE" | "UPSERT" | "DELETE" | "IMPORT";
  target: string;
  record_type: RecordType | null;
  submitted_by: string;
}

export interface RecordChange extends DnsRecord {
  change: ChangeInfo;
}
