"use client";

import { Suspense, useState } from "react";
import { useRouter } from "next/navigation";
import Alert from "@cloudscape-design/components/alert";
import Button from "@cloudscape-design/components/button";
import CollectionPreferences from "@cloudscape-design/components/collection-preferences";
import Header from "@cloudscape-design/components/header";
import Link from "@cloudscape-design/components/link";
import Pagination from "@cloudscape-design/components/pagination";
import Select, { SelectProps } from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table, { TableProps } from "@cloudscape-design/components/table";
import TextFilter from "@cloudscape-design/components/text-filter";
import { TableEmptyState } from "@/components/common/TableStates";
import { DeleteZoneModal } from "@/components/hosted-zones/DeleteZoneModal";
import { EditZoneModal } from "@/components/hosted-zones/EditZoneModal";
import { useBreadcrumbs } from "@/components/layout/ShellContext";
import { useFollow } from "@/hooks/useFollow";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useServerCollection } from "@/hooks/useServerCollection";
import { useWriteAccess } from "@/hooks/useWriteAccess";
import { api } from "@/lib/api";
import type { HostedZone, ZoneType } from "@/types";

const TYPE_OPTIONS: SelectProps.Option[] = [
  { label: "All hosted zone types", value: "" },
  { label: "Public", value: "public" },
  { label: "Private", value: "private" },
];

const PAGE_SIZES = [10, 25, 50];
const ZONE_TYPES = ["public", "private"] as const;

export default function HostedZonesPage() {
  return (
    <Suspense fallback={null}>
      <HostedZones />
    </Suspense>
  );
}

function HostedZones() {
  const router = useRouter();
  const { readOnly, deniedReason } = useWriteAccess();
  const follow = useFollow();
  useBreadcrumbs([
    { text: "Route 53", href: "/dashboard" },
    { text: "Hosted zones", href: "/hosted-zones" },
  ]);

  const [visibleColumns, setVisibleColumns] = useState<readonly string[]>([
    "name", "type", "createdBy", "recordCount", "description", "id",
  ]);
  const [editing, setEditing] = useState<HostedZone | null>(null);
  const [deleting, setDeleting] = useState<HostedZone | null>(null);

  const {
    data, loading, error, reload, items, total, search, filterText, setFilterText, filters, setFilter,
    clearFilters, page, setPage, pageSize, setPageSize, selected, setSelected, filterRef,
  } = useServerCollection(
    ({ search, page, pageSize, filters }) =>
      api.zones.list({ search, type: (filters.type || undefined) as ZoneType | undefined, page, page_size: pageSize }),
    [],
    { pageSizes: PAGE_SIZES, defaultPageSize: 10, filters: { type: ZONE_TYPES }, syncUrl: true },
  );
  const zoneType = filters.type;
  const typeFilter = TYPE_OPTIONS.find((o) => o.value === zoneType) ?? TYPE_OPTIONS[0];

  const isFiltering = !!search || !!zoneType;
  const current = selected[0];

  const deleteSelected = () => current && !readOnly && setDeleting(current);
  useKeyboardShortcuts([
    { key: "c", description: "Create hosted zone", handler: () => !readOnly && router.push("/hosted-zones/create") },
    { key: "r", description: "Refresh", handler: reload },
    { key: "e", description: "Edit the selected hosted zone", handler: () => current && !readOnly && setEditing(current) },
    { key: "Delete", description: "Delete the selected hosted zone", handler: deleteSelected },
    { key: "Backspace", description: "Delete the selected hosted zone", handler: deleteSelected },
    { key: "Escape", description: "Clear the selection", handler: () => setSelected([]) },
  ]);

  const columns: TableProps.ColumnDefinition<HostedZone>[] = [
    {
      id: "name",
      header: "Hosted zone name",
      cell: (z) => (
        <Link href={`/hosted-zones/${z.id}`} onFollow={follow}>
          {z.name}
        </Link>
      ),
      isRowHeader: true,
      width: 250,
    },
    { id: "type", header: "Type", cell: (z) => (z.type === "public" ? "Public" : "Private"), width: 100 },
    { id: "createdBy", header: "Created by", cell: (z) => z.created_by, width: 130 },
    { id: "recordCount", header: "Record count", cell: (z) => z.record_count, width: 135 },
    { id: "description", header: "Description", cell: (z) => z.comment || "-", width: 195 },
    { id: "id", header: "Hosted zone ID", cell: (z) => z.id, minWidth: 220 },
  ];

  return (
    <>
      <SpaceBetween size="m">
        {error && (
          <Alert
            type="error"
            header="Failed to load hosted zones"
            action={<Button onClick={reload}>Retry</Button>}
          >
            {error}
          </Alert>
        )}
        <Table
          variant="full-page"
          items={items}
          columnDefinitions={columns}
          columnDisplay={columns.map((c) => ({ id: c.id!, visible: visibleColumns.includes(c.id!) }))}
          trackBy="id"
          selectionType="single"
          selectedItems={selected}
          onSelectionChange={({ detail }) => setSelected(detail.selectedItems)}
          loading={loading && !data}
          loadingText="Loading hosted zones"
          resizableColumns
          stickyHeader
          ariaLabels={{
            selectionGroupLabel: "Hosted zone selection",
            itemSelectionLabel: (_s, z) => z.name,
            allItemsSelectionLabel: () => "select all",
          }}
          header={
            <Header
              variant="awsui-h1-sticky"
              counter={data ? `(${total})` : undefined}
              description="A hosted zone is a container for records, which include information about how you want to route traffic for a domain (such as example.com) and all of its subdomains."
              actions={
                <SpaceBetween direction="horizontal" size="xs">
                  <Button iconName="refresh" ariaLabel="Refresh" onClick={reload} loading={loading && !!data} />
                  <Button
                    disabled={!current}
                    onClick={() => current && router.push(`/hosted-zones/${current.id}`)}
                  >
                    View details
                  </Button>
                  <Button disabled={!current || readOnly} disabledReason={deniedReason} onClick={() => setEditing(current)}>
                    Edit
                  </Button>
                  <Button disabled={!current || readOnly} disabledReason={deniedReason} onClick={() => setDeleting(current)}>
                    Delete
                  </Button>
                  <Button
                    variant="primary"
                    href="/hosted-zones/create"
                    onFollow={follow}
                    disabled={readOnly}
                    disabledReason={deniedReason}
                  >
                    Create hosted zone
                  </Button>
                </SpaceBetween>
              }
            >
              Hosted zones
            </Header>
          }
          filter={
            <div ref={filterRef} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 320px", maxWidth: 560 }}>
                <TextFilter
                  filteringText={filterText}
                  filteringPlaceholder="Filter hosted zones by name, ID or description"
                  filteringAriaLabel="Filter hosted zones"
                  onChange={({ detail }) => setFilterText(detail.filteringText)}
                  countText={isFiltering && data ? `${total} match${total === 1 ? "" : "es"}` : undefined}
                />
              </div>
              <div style={{ flex: "0 0 220px" }}>
                <Select
                  selectedOption={typeFilter}
                  onChange={({ detail }) => setFilter("type", detail.selectedOption.value ?? "")}
                  options={TYPE_OPTIONS}
                  ariaLabel="Filter by hosted zone type"
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
              preferences={{ pageSize, contentDisplay: columns.map((c) => ({ id: c.id!, visible: visibleColumns.includes(c.id!) })) }}
              pageSizePreference={{
                title: "Page size",
                options: PAGE_SIZES.map((n) => ({ value: n, label: `${n} hosted zones` })),
              }}
              contentDisplayPreference={{
                title: "Column preferences",
                options: columns.map((c) => ({ id: c.id!, label: c.header as string, alwaysVisible: c.id === "name" })),
              }}
              onConfirm={({ detail }) => {
                if (detail.pageSize) setPageSize(detail.pageSize);
                if (detail.contentDisplay)
                  setVisibleColumns(detail.contentDisplay.filter((c) => c.visible).map((c) => c.id));
              }}
            />
          }
          empty={
            isFiltering ? (
              <TableEmptyState
                title="No matches"
                subtitle="We can't find a match."
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
                title="No hosted zones"
                subtitle="You don't have any hosted zones."
                action={
                  <Button href="/hosted-zones/create" onFollow={follow} disabled={readOnly} disabledReason={deniedReason}>
                    Create hosted zone
                  </Button>
                }
              />
            )
          }
        />
      </SpaceBetween>

      <EditZoneModal
        zone={editing}
        onDismiss={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          reload();
        }}
      />
      <DeleteZoneModal
        zone={deleting}
        onDismiss={() => setDeleting(null)}
        onDeleted={() => {
          setDeleting(null);
          setSelected([]);
          reload();
        }}
      />
    </>
  );
}
