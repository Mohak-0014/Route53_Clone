import type {
  Change,
  ChangeInfo,
  DnsRecord,
  DnsRecordInput,
  HostedZone,
  HostedZoneInput,
  ImportResult,
  Page,
  RecordChange,
  RecordType,
  SessionInfo,
  TestRecordResult,
  ZoneType,
} from "@/types";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");
const TOKEN_KEY = "r53.session";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const tokenStore = {
  get: (): string | null => (typeof window === "undefined" ? null : window.localStorage.getItem(TOKEN_KEY)),
  set: (token: string) => window.localStorage.setItem(TOKEN_KEY, token),
  clear: () => window.localStorage.removeItem(TOKEN_KEY),
};

/** Fired when any request comes back 401 so the auth provider can redirect to sign-in. */
export const UNAUTHORIZED_EVENT = "r53:unauthorized";

type Query = Record<string, string | number | undefined | null>;

function buildUrl(path: string, query?: Query) {
  const url = new URL(API_URL + path);
  Object.entries(query ?? {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  });
  return url.toString();
}

async function request<T>(method: string, path: string, opts: { query?: Query; body?: unknown; raw?: boolean } = {}) {
  const headers: Record<string, string> = {};
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "NetworkError", "Unable to reach the Route 53 API. Check your connection and try again.");
  }

  if (!res.ok) {
    let code = "Error";
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      code = data.code ?? code;
      message = data.message ?? data.detail ?? message;
    } catch {
      /* non-JSON error body */
    }
    if (res.status === 401 && path !== "/api/auth/login") {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    throw new ApiError(res.status, code, message);
  }
  if (res.status === 204) return undefined as T;
  return (opts.raw ? await res.text() : await res.json()) as T;
}

export interface ListParams {
  search?: string;
  page?: number;
  page_size?: number;
}

export const api = {
  auth: {
    login: (account_id: string, username: string, password: string) =>
      request<SessionInfo>("POST", "/api/auth/login", { body: { account_id, username, password } }),
    session: () => request<SessionInfo>("GET", "/api/auth/session"),
    logout: () => request<void>("POST", "/api/auth/logout"),
  },
  zones: {
    list: (params: ListParams & { type?: ZoneType }) =>
      request<Page<HostedZone>>("GET", "/api/hosted-zones", { query: { ...params } }),
    get: (id: string) => request<HostedZone>("GET", `/api/hosted-zones/${encodeURIComponent(id)}`),
    create: (body: HostedZoneInput) => request<HostedZone>("POST", "/api/hosted-zones", { body }),
    update: (id: string, comment: string) =>
      request<HostedZone>("PUT", `/api/hosted-zones/${encodeURIComponent(id)}`, { body: { comment } }),
    remove: (id: string) => request<void>("DELETE", `/api/hosted-zones/${encodeURIComponent(id)}`),
    testRecord: (id: string, record_name: string, type: RecordType) =>
      request<TestRecordResult>("POST", `/api/hosted-zones/${encodeURIComponent(id)}/test-record`, {
        body: { record_name, type },
      }),
    exportBind: (id: string) =>
      request<string>("GET", `/api/hosted-zones/${encodeURIComponent(id)}/export`, {
        query: { format: "bind" },
        raw: true,
      }),
    exportJson: (id: string) =>
      request<unknown>("GET", `/api/hosted-zones/${encodeURIComponent(id)}/export`, { query: { format: "json" } }),
  },
  records: {
    list: (zoneId: string, params: ListParams & { type?: string }) =>
      request<Page<DnsRecord>>("GET", `/api/hosted-zones/${encodeURIComponent(zoneId)}/records`, {
        query: { ...params },
      }),
    get: (zoneId: string, id: string) =>
      request<DnsRecord>("GET", `/api/hosted-zones/${encodeURIComponent(zoneId)}/records/${encodeURIComponent(id)}`),
    create: (zoneId: string, body: DnsRecordInput) =>
      request<RecordChange>("POST", `/api/hosted-zones/${encodeURIComponent(zoneId)}/records`, { body }),
    createBatch: (zoneId: string, records: DnsRecordInput[]) =>
      request<{ records: DnsRecord[]; change: ChangeInfo }>("POST", `/api/hosted-zones/${encodeURIComponent(zoneId)}/records/batch`, {
        body: { records },
      }),
    update: (zoneId: string, id: string, body: DnsRecordInput) =>
      request<RecordChange>(
        "PUT",
        `/api/hosted-zones/${encodeURIComponent(zoneId)}/records/${encodeURIComponent(id)}`,
        { body },
      ),
    remove: (zoneId: string, id: string) =>
      request<{ change: ChangeInfo }>(
        "DELETE",
        `/api/hosted-zones/${encodeURIComponent(zoneId)}/records/${encodeURIComponent(id)}`,
      ),
    bulkRemove: (zoneId: string, record_ids: string[]) =>
      request<{ deleted: number; skipped: number; change: ChangeInfo | null }>(
        "POST",
        `/api/hosted-zones/${encodeURIComponent(zoneId)}/records/bulk-delete`,
        { body: { record_ids } },
      ),
    importZoneFile: (zoneId: string, zone_file: string) =>
      request<ImportResult>("POST", `/api/hosted-zones/${encodeURIComponent(zoneId)}/records/import`, {
        body: { zone_file },
      }),
  },
  changes: {
    /** Route 53 GetChange: current status of a submitted change. */
    get: (id: string) => request<Change>("GET", `/api/changes/${encodeURIComponent(id)}`),
    /** A hosted zone's change history, newest first. */
    listForZone: (zoneId: string, params: ListParams) =>
      request<Page<Change>>("GET", `/api/hosted-zones/${encodeURIComponent(zoneId)}/changes`, { query: { ...params } }),
  },
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}
