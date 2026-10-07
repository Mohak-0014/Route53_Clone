"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Page } from "@/types";
import { useApiQuery } from "./useApiQuery";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";

const SEARCH_DEBOUNCE_MS = 300;

export interface CollectionQuery<F extends string> {
  search: string;
  page: number;
  pageSize: number;
  filters: Record<F, string>;
}

export interface CollectionOptions<F extends string> {
  pageSizes: readonly number[];
  defaultPageSize: number;
  /** Allowed values per extra filter (e.g. `type`); "" means "no filter". */
  filters: Record<F, readonly string[]>;
  /** Mirror search, filters, page and page size in the URL (?search=&type=&page=&pageSize=). */
  syncUrl?: boolean;
}

/** Parse a query string into a valid collection query; anything invalid falls back to the default. */
function parseQuery<F extends string>(params: URLSearchParams, opts: CollectionOptions<F>): CollectionQuery<F> {
  const page = Number(params.get("page"));
  const pageSize = Number(params.get("pageSize"));
  const filters = {} as Record<F, string>;
  for (const key of Object.keys(opts.filters) as F[]) {
    const value = params.get(key) ?? "";
    filters[key] = opts.filters[key].includes(value) ? value : "";
  }
  return {
    search: (params.get("search") ?? "").trim().slice(0, 255),
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    pageSize: opts.pageSizes.includes(pageSize) ? pageSize : opts.defaultPageSize,
    filters,
  };
}

/** The canonical query string for a collection query (defaults omitted, stable key order). */
export function collectionQueryString<F extends string>(q: CollectionQuery<F>, defaultPageSize: number): string {
  const params = new URLSearchParams();
  if (q.search) params.set("search", q.search);
  for (const [key, value] of Object.entries(q.filters) as [string, string][]) {
    if (value) params.set(key, value);
  }
  if (q.page > 1) params.set("page", String(q.page));
  if (q.pageSize !== defaultPageSize) params.set("pageSize", String(q.pageSize));
  return params.toString();
}

/**
 * State for a server-side table: debounced text filter, extra filters, pagination,
 * selection, the "/" shortcut, and (optionally) two-way sync with the URL so refresh,
 * shared links and the back button restore the same view. Changing the search, a
 * filter or the page size returns to page 1.
 */
export function useServerCollection<T extends { id: string }, F extends string>(
  fetchPage: (q: CollectionQuery<F>) => Promise<Page<T>>,
  deps: readonly unknown[],
  opts: CollectionOptions<F>,
) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlQs = searchParams.toString();
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const [initial] = useState(() =>
    parseQuery(opts.syncUrl ? new URLSearchParams(urlQs) : new URLSearchParams(), opts),
  );
  const [filterText, setFilterTextRaw] = useState(initial.search);
  const [search, setSearch] = useState(initial.search);
  const [page, setPage] = useState(initial.page);
  const [pageSize, setPageSizeRaw] = useState(initial.pageSize);
  const [filters, setFilters] = useState(initial.filters);
  const [selected, setSelected] = useState<T[]>([]);
  const filterRef = useRef<HTMLDivElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const setFilterText = useCallback((value: string) => {
    setFilterTextRaw(value);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      setSearch(value.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
  }, []);
  const setFilter = useCallback((key: F, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  }, []);
  const setPageSize = useCallback((size: number) => {
    setPageSizeRaw(size);
    setPage(1);
  }, []);
  const clearFilters = useCallback(() => {
    clearTimeout(debounce.current);
    setFilterTextRaw("");
    setSearch("");
    setFilters(parseQuery(new URLSearchParams(), optsRef.current).filters);
    setPage(1);
  }, []);
  useEffect(() => () => clearTimeout(debounce.current), []);

  const query: CollectionQuery<F> = { search, page, pageSize, filters };
  const queryString = collectionQueryString(query, opts.defaultPageSize);
  const depsKey = JSON.stringify(deps);

  const result = useApiQuery(() => fetchPage(query), [queryString, depsKey]);
  const { data } = result;

  // --- URL sync: state → URL (replace, so typing doesn't add history entries)
  const written = useRef(new Set<string>());
  useEffect(() => {
    if (!opts.syncUrl) return;
    // Compare with the raw URL so invalid or non-canonical params are rewritten too.
    if (urlQs === queryString) return;
    if (written.current.size > 20) written.current.clear();
    written.current.add(queryString);
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
    // Only our own state should trigger a write; URL changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryString]);

  // --- URL sync: URL → state (back/forward, shared links, links from elsewhere)
  useEffect(() => {
    if (!opts.syncUrl) return;
    const parsed = parseQuery(new URLSearchParams(urlQs), optsRef.current);
    const incoming = collectionQueryString(parsed, optsRef.current.defaultPageSize);
    if (written.current.has(incoming)) {
      written.current.delete(incoming); // our own write arriving back
      return;
    }
    clearTimeout(debounce.current);
    setFilterTextRaw(parsed.search);
    setSearch(parsed.search);
    setFilters(parsed.filters);
    setPage(parsed.page);
    setPageSizeRaw(parsed.pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQs]);

  // A new query is a new result set: start a fresh selection, even if the user clicked
  // rows while the request was in flight. A plain reload keeps the selection in sync.
  const resultKey = `${queryString}|${depsKey}`;
  useEffect(() => setSelected([]), [resultKey]);
  const dataKey = useRef(resultKey);
  useEffect(() => {
    if (!data) return;
    if (dataKey.current !== resultKey) {
      dataKey.current = resultKey;
      setSelected([]);
    } else {
      setSelected((sel) => sel.map((s) => data.items.find((i) => i.id === s.id)).filter((i): i is T => !!i));
    }
    // Step back if a delete emptied the last page (or a shared link pointed past the end).
    if (data.page > data.total_pages) setPage(data.total_pages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // "/" focuses the filter, like many AWS consoles.
  useKeyboardShortcuts([
    {
      key: "/",
      description: "Focus the table filter",
      handler: () => filterRef.current?.querySelector("input")?.focus(),
    },
  ]);

  return {
    ...result,
    filterText,
    setFilterText,
    search,
    filters,
    setFilter,
    clearFilters,
    page,
    setPage,
    pageSize,
    setPageSize,
    selected,
    setSelected,
    filterRef,
    /** Canonical query string of the current view, e.g. to return here from another page. */
    queryString,
    total: data?.total ?? 0,
    items: data?.items ?? [],
  };
}
