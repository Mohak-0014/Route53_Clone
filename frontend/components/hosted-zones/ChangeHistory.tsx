"use client";

import { useEffect, useState } from "react";
import Alert from "@cloudscape-design/components/alert";
import Button from "@cloudscape-design/components/button";
import Header from "@cloudscape-design/components/header";
import Pagination from "@cloudscape-design/components/pagination";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table, { TableProps } from "@cloudscape-design/components/table";
import { TableEmptyState } from "@/components/common/TableStates";
import { useApiQuery } from "@/hooks/useApiQuery";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { Change } from "@/types";

const PAGE_SIZE = 10;
const PENDING_REFRESH_MS = 3000;

const ACTION_LABELS: Record<Change["action"], string> = {
  CREATE: "Create",
  UPSERT: "Update",
  DELETE: "Delete",
  IMPORT: "Import",
};

const COLUMNS: TableProps.ColumnDefinition<Change>[] = [
  { id: "id", header: "Change ID", cell: (c) => c.id, isRowHeader: true, minWidth: 230 },
  { id: "action", header: "Action", cell: (c) => ACTION_LABELS[c.action] ?? c.action },
  { id: "target", header: "Record", cell: (c) => c.target },
  { id: "type", header: "Type", cell: (c) => c.record_type ?? "-" },
  { id: "submittedBy", header: "Submitted by", cell: (c) => c.submitted_by },
  { id: "submitted", header: "Submitted", cell: (c) => formatDate(c.submitted_at) },
  {
    id: "status",
    header: "Status",
    minWidth: 120,
    cell: (c) => (
      <StatusIndicator type={c.status === "INSYNC" ? "success" : "pending"}>{c.status}</StatusIndicator>
    ),
  },
];

/** The hosted zone's change history: every record change with its PENDING / INSYNC status. */
export function ChangeHistory({ zoneId }: { zoneId: string }) {
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useApiQuery(
    () => api.changes.listForZone(zoneId, { page, page_size: PAGE_SIZE }),
    [zoneId, page],
  );

  // While a change is still propagating, refresh until it reports INSYNC.
  const hasPending = !!data?.items.some((c) => c.status === "PENDING");
  useEffect(() => {
    if (!hasPending) return;
    const t = setTimeout(reload, PENDING_REFRESH_MS);
    return () => clearTimeout(t);
  }, [hasPending, data, reload]);

  return (
    <SpaceBetween size="m">
      {error && (
        <Alert type="error" header="Failed to load change history" action={<Button onClick={reload}>Retry</Button>}>
          {error}
        </Alert>
      )}
      <Table
        variant="container"
        items={data?.items ?? []}
        columnDefinitions={COLUMNS}
        trackBy="id"
        loading={loading && !data}
        loadingText="Loading change history"
        resizableColumns
        wrapLines
        header={
          <Header
            counter={data ? `(${data.total})` : undefined}
            description="Changes to records in this hosted zone. A change is PENDING until it has propagated to all Route 53 DNS servers, then INSYNC."
            actions={
              <Button iconName="refresh" ariaLabel="Refresh change history" onClick={reload} loading={loading && !!data} />
            }
          >
            Change history
          </Header>
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
        empty={
          <TableEmptyState
            title="No changes yet"
            subtitle="Creating, editing, deleting or importing records adds an entry here."
          />
        }
      />
    </SpaceBetween>
  );
}
