"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import CollectionPreferences from "@cloudscape-design/components/collection-preferences";
import Header from "@cloudscape-design/components/header";
import Pagination from "@cloudscape-design/components/pagination";
import Select, { SelectProps } from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table, { TableProps } from "@cloudscape-design/components/table";
import TextFilter from "@cloudscape-design/components/text-filter";
import { TableEmptyState } from "@/components/common/TableStates";
import { useShell } from "@/components/layout/ShellContext";
import { useColumnPreferences } from "@/hooks/useColumnPreferences";
import { useFollow } from "@/hooks/useFollow";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useServerCollection } from "@/hooks/useServerCollection";
import { useWriteAccess } from "@/hooks/useWriteAccess";
import { api } from "@/lib/api";
import { DnsRecord, HostedZone, RECORD_TYPES } from "@/types";
import { DeleteRecordsModal } from "./DeleteRecordsModal";
import { ImportZoneFileModal } from "./ImportZoneFileModal";
import { RecordDetails } from "./RecordDetails";
import { RecordValues } from "./RecordValues";

const FILTER_TYPES = [...RECORD_TYPES, "SOA"].sort();
const TYPE_OPTIONS: SelectProps.Option[] = [
  { label: "Type: All", value: "" },
  ...FILTER_TYPES.map((t) => ({ label: t, value: t })),
];
const PAGE_SIZES = [10, 25, 50, 100];
// Differentiator is always "-" with simple routing, so it starts hidden (available in Preferences).
const DEFAULT_COLUMNS = ["name", "type", "routing", "alias", "value", "ttl"];
const ALL_COLUMNS = [
  "name", "type", "routing", "differentiator", "alias", "value", "ttl", "healthCheck", "evaluate", "recordId",
];

export function RecordsTable({ zone, onChanged }: { zone: HostedZone; onChanged: () => void }) {
  const router = useRouter();
  const follow = useFollow();
  const { setSplitPanel } = useShell();
  const { readOnly, deniedReason } = useWriteAccess();
  const [visibleColumns, setVisibleColumns] = useColumnPreferences("records", ALL_COLUMNS, DEFAULT_COLUMNS);
  const [deleting, setDeleting] = useState<DnsRecord[]>([]);
  const [importing, setImporting] = useState(false);

  const {
    data, loading, error, reload, items, total, search, filterText, setFilterText, filters, setFilter,
    clearFilters, page, setPage, pageSize, setPageSize, selected, setSelected, filterRef, queryString,
  } = useServerCollection(
    ({ search, page, pageSize, filters }) =>
      api.records.list(zone.id, { search, type: filters.type || undefined, page, page_size: pageSize }),
    [zone.id],
    { pageSizes: PAGE_SIZES, defaultPageSize: 25, filters: { type: FILTER_TYPES }, syncUrl: true },
  );
  const type = filters.type;
  const typeFilter = TYPE_OPTIONS.find((o) => o.value === type) ?? TYPE_OPTIONS[0];
  // Create/Edit pages return to this exact view (search, filter, page) on Save or Cancel.
  const back = queryString ? `?back=${encodeURIComponent(queryString)}` : "";

  const editHref = useCallback(
    (r: DnsRecord) => `/hosted-zones/${zone.id}/records/${r.id}/edit${back}`,
    [zone.id, back],
  );
  const createHref = `/hosted-zones/${zone.id}/records/create${back}`;

  // One selected record → "Record details" split panel, as in the Route 53 console.
  const single = selected.length === 1 ? selected[0] : null;
  useEffect(() => {
    setSplitPanel(
      single
        ? {
            header: "Record details",
            content: (
              <RecordDetails record={single} onEdit={() => router.push(editHref(single))} deniedReason={deniedReason} />
            ),
          }
        : null,
    );
  }, [single, setSplitPanel, router, editHref, deniedReason]);
  useEffect(() => () => setSplitPanel(null), [setSplitPanel]);

  const refreshAll = () => {
    reload();
    onChanged();
  };

  const deleteSelected = () => selected.length > 0 && !readOnly && setDeleting(selected);
  useKeyboardShortcuts([
    { key: "c", description: "Create record", handler: () => !readOnly && router.push(createHref) },
    { key: "r", description: "Refresh records", handler: refreshAll },
    { key: "e", description: "Edit the selected record", handler: () => single && !readOnly && router.push(editHref(single)) },
    { key: "Delete", description: "Delete the selected records", handler: deleteSelected },
    { key: "Backspace", description: "Delete the selected records", handler: deleteSelected },
    { key: "Escape", description: "Clear the selection", handler: () => setSelected([]) },
  ]);

  const isFiltering = !!search || !!type;

  const columns: TableProps.ColumnDefinition<DnsRecord>[] = [
    // Widths keep name, type, routing, alias, value and TTL on screen at 1440px with the side nav open.
    {
      id: "name",
      header: "Record name",
      cell: (r) => <RecordValues values={[r.name]} />,
      isRowHeader: true,
      width: 220,
      minWidth: 160,
    },
    { id: "type", header: "Type", cell: (r) => r.type, width: 80, minWidth: 70 },
    { id: "routing", header: "Routing policy", cell: () => "Simple", width: 130, minWidth: 110 },
    { id: "differentiator", header: "Differentiator", cell: () => "-", width: 130 },
    { id: "alias", header: "Alias", cell: (r) => (r.alias ? "Yes" : "No"), width: 80, minWidth: 70 },
    {
      id: "value",
      header: "Value/Route traffic to",
      cell: (r) => <RecordValues values={r.values} />,
      width: 360,
      minWidth: 220,
    },
    { id: "ttl", header: "TTL (seconds)", cell: (r) => r.ttl, width: 120, minWidth: 110 },
    { id: "healthCheck", header: "Health check ID", cell: () => "-", width: 150 },
    { id: "evaluate", header: "Evaluate target health", cell: () => "-", width: 180 },
    { id: "recordId", header: "Record ID", cell: (r) => r.id, width: 200 },
  ];
  const columnDisplay = columns.map((c) => ({ id: c.id!, visible: visibleColumns.includes(c.id!) }));

  return (
    <SpaceBetween size="m">
      {error && (
        <Alert type="error" header="Failed to load records" action={<Button onClick={reload}>Retry</Button>}>
          {error}
        </Alert>
      )}
      <Table
        variant="container"
        items={items}
        columnDefinitions={columns}
        columnDisplay={columnDisplay}
        trackBy="id"
        selectionType="multi"
        selectedItems={selected}
        onSelectionChange={({ detail }) => setSelected(detail.selectedItems)}
        loading={loading && !data}
        loadingText="Loading records"
        resizableColumns
        wrapLines
        ariaLabels={{
          selectionGroupLabel: "Record selection",
          itemSelectionLabel: (_s, r) => `${r.name} ${r.type}`,
          allItemsSelectionLabel: () => "Select all records on this page",
        }}
        header={
          <Header
            counter={data ? (selected.length ? `(${selected.length}/${total})` : `(${total})`) : undefined}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh records" onClick={refreshAll} loading={loading && !!data} />
                <Button
                  disabled={selected.length === 0 || readOnly}
                  disabledReason={deniedReason}
                  onClick={() => setDeleting(selected)}
                >
                  Delete record
                </Button>
                <Button onClick={() => setImporting(true)} disabled={readOnly} disabledReason={deniedReason}>
                  Import zone file
                </Button>
                <Button
                  variant="primary"
                  href={createHref}
                  onFollow={follow}
                  disabled={readOnly}
                  disabledReason={deniedReason}
                >
                  Create record
                </Button>
              </SpaceBetween>
            }
          >
            Records
          </Header>
        }
        filter={
          <div ref={filterRef} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 320px", maxWidth: 560 }}>
              <TextFilter
                filteringText={filterText}
                filteringPlaceholder="Filter records by property or value"
                filteringAriaLabel="Filter records"
                onChange={({ detail }) => setFilterText(detail.filteringText)}
                countText={isFiltering && data ? `${total} match${total === 1 ? "" : "es"}` : undefined}
              />
            </div>
            <div style={{ flex: "0 0 160px" }}>
              <Select
                selectedOption={typeFilter}
                onChange={({ detail }) => setFilter("type", detail.selectedOption.value ?? "")}
                options={TYPE_OPTIONS}
                ariaLabel="Filter by record type"
              />
            </div>
          </div>
        }
        pagination={
          <Pagination
            currentPageIndex={page}
            pagesCount={data?.total_pages ?? 1}
            onChange={({ detail }) => setPage(detail.currentPageIndex)}
            ariaLabels={{
              nextPageLabel: "Next page",
              previousPageLabel: "Previous page",
              pageLabel: (n) => `Page ${n} of all pages`,
            }}
          />
        }
        preferences={
          <CollectionPreferences
            title="Preferences"
            confirmLabel="Confirm"
            cancelLabel="Cancel"
            preferences={{ pageSize, contentDisplay: columnDisplay }}
            pageSizePreference={{
              title: "Page size",
              options: PAGE_SIZES.map((n) => ({ value: n, label: `${n} records` })),
            }}
            contentDisplayPreference={{
              title: "Column preferences",
              options: columns.map((c) => ({ id: c.id!, label: c.header as string, alwaysVisible: c.id === "name" })),
            }}
            onConfirm={({ detail }) => {
              if (detail.pageSize) setPageSize(detail.pageSize);
              if (detail.contentDisplay) setVisibleColumns(detail.contentDisplay.filter((c) => c.visible).map((c) => c.id));
            }}
          />
        }
        empty={
          isFiltering ? (
            <TableEmptyState
              title="No matches"
              subtitle="No records match the filter."
              action={
                <Button
                  onClick={() => {
                    clearFilters();
                  }}
                >
                  Clear filter
                </Button>
              }
            />
          ) : (
            <TableEmptyState
              title="No records"
              subtitle="This hosted zone doesn't have any records."
              action={
                <Button href={createHref} onFollow={follow} disabled={readOnly} disabledReason={deniedReason}>
                  Create record
                </Button>
              }
            />
          )
        }
      />
      <Box fontSize="body-s" color="text-body-secondary">
        Press <kbd>?</kbd> for keyboard shortcuts
      </Box>

      <DeleteRecordsModal
        zoneId={zone.id}
        records={deleting}
        onDismiss={() => setDeleting([])}
        onDeleted={() => {
          setDeleting([]);
          setSelected([]);
          refreshAll();
        }}
      />
      <ImportZoneFileModal
        zoneId={zone.id}
        zoneName={zone.name}
        visible={importing}
        onDismiss={() => setImporting(false)}
        onImported={refreshAll}
      />
    </SpaceBetween>
  );
}
