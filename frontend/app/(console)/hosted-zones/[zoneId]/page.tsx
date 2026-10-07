"use client";

import { Suspense, use, useState } from "react";
import { useRouter } from "next/navigation";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
import ContentLayout from "@cloudscape-design/components/content-layout";
import CopyToClipboard from "@cloudscape-design/components/copy-to-clipboard";
import ExpandableSection from "@cloudscape-design/components/expandable-section";
import Header from "@cloudscape-design/components/header";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import Tabs from "@cloudscape-design/components/tabs";
import { ChangeHistory } from "@/components/hosted-zones/ChangeHistory";
import { DeleteZoneModal } from "@/components/hosted-zones/DeleteZoneModal";
import { EditZoneModal } from "@/components/hosted-zones/EditZoneModal";
import { useBreadcrumbs } from "@/components/layout/ShellContext";
import { useNotifications } from "@/components/providers/NotificationsProvider";
import { RecordsTable } from "@/components/records/RecordsTable";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useFollow } from "@/hooks/useFollow";
import { useWriteAccess } from "@/hooks/useWriteAccess";
import { api, errorMessage } from "@/lib/api";
import { downloadFile, formatDate } from "@/lib/format";
import type { HostedZone } from "@/types";

export default function HostedZoneDetailPage({ params }: { params: Promise<{ zoneId: string }> }) {
  const { zoneId } = use(params);
  const router = useRouter();
  const follow = useFollow();
  const { readOnly, deniedReason } = useWriteAccess();
  const { notify } = useNotifications();
  const { data: zone, error, loading, reload } = useApiQuery(() => api.zones.get(zoneId), [zoneId]);
  const [editing, setEditing] = useState<HostedZone | null>(null);
  const [deleting, setDeleting] = useState<HostedZone | null>(null);
  const [activeTab, setActiveTab] = useState("records");

  useBreadcrumbs([
    { text: "Route 53", href: "/dashboard" },
    { text: "Hosted zones", href: "/hosted-zones" },
    { text: zone?.name ?? zoneId, href: `/hosted-zones/${zoneId}` },
  ]);

  const exportZone = async (format: "bind" | "json") => {
    if (!zone) return;
    try {
      if (format === "bind") {
        downloadFile(`${zone.name}.zone`, await api.zones.exportBind(zone.id), "text/plain");
      } else {
        const json = await api.zones.exportJson(zone.id);
        downloadFile(`${zone.name}.json`, JSON.stringify(json, null, 2), "application/json");
      }
      notify({ type: "success", content: `Exported ${zone.name} as ${format === "bind" ? "a BIND zone file" : "JSON"}.` });
    } catch (e) {
      notify({ type: "error", header: "Export failed", content: errorMessage(e) });
    }
  };

  if (!zone) {
    if (loading) {
      return (
        <div className="r53-center">
          <Spinner size="large" />
        </div>
      );
    }
    const notFound = error && /No hosted zone/.test(error);
    return (
      <Alert
        type="error"
        header={notFound ? "Hosted zone not found" : "Failed to load hosted zone"}
        action={
          notFound ? (
            <Button onClick={() => router.push("/hosted-zones")}>Back to hosted zones</Button>
          ) : (
            <Button onClick={reload}>Retry</Button>
          )
        }
      >
        {error}
      </Alert>
    );
  }

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button onClick={() => setDeleting(zone)} disabled={readOnly} disabledReason={deniedReason}>
                Delete zone
              </Button>
              <Button href={`/hosted-zones/${zone.id}/test-record`} onFollow={follow}>
                Test record
              </Button>
              <Button
                disabled
                disabledReason="Query logging sends DNS query logs to CloudWatch Logs, which isn't part of this clone."
              >
                Configure query logging
              </Button>
              <ButtonDropdown
                items={[
                  { id: "bind", text: "BIND zone file" },
                  { id: "json", text: "JSON" },
                ]}
                onItemClick={({ detail }) => exportZone(detail.id as "bind" | "json")}
              >
                Export zone
              </ButtonDropdown>
              <Button onClick={() => setEditing(zone)} disabled={readOnly} disabledReason={deniedReason}>
                Edit hosted zone
              </Button>
            </SpaceBetween>
          }
        >
          {zone.name}
        </Header>
      }
    >
      <SpaceBetween size="l">
        <ExpandableSection
          variant="container"
          headerText="Hosted zone details"
          headerActions={
            <Button onClick={() => setEditing(zone)} disabled={readOnly} disabledReason={deniedReason}>
              Edit hosted zone
            </Button>
          }
        >
          <KeyValuePairs
            columns={3}
            items={[
              { label: "Hosted zone name", value: zone.name },
              {
                label: "Hosted zone ID",
                value: (
                  <CopyToClipboard
                    variant="inline"
                    textToCopy={zone.id}
                    copySuccessText="Hosted zone ID copied"
                    copyErrorText="Failed to copy"
                  />
                ),
              },
              {
                label: "Hosted zone ARN",
                value: (
                  <CopyToClipboard
                    variant="inline"
                    textToCopy={`arn:aws:route53:::hostedzone/${zone.id}`}
                    copySuccessText="Hosted zone ARN copied"
                    copyErrorText="Failed to copy"
                  />
                ),
              },
              { label: "Description", value: zone.comment || "-" },
              { label: "Type", value: zone.type === "public" ? "Public hosted zone" : "Private hosted zone" },
              { label: "Record count", value: String(zone.record_count) },
              { label: "Query log", value: "-" },
              {
                label: "Name servers",
                value: (
                  <Box variant="code" fontSize="body-s">
                    <span className="r53-values">{zone.name_servers.join("\n") || "-"}</span>
                  </Box>
                ),
              },
              ...(zone.type === "private"
                ? [
                    { label: "VPC region", value: zone.vpc_region ?? "-" },
                    { label: "VPC ID", value: zone.vpc_id ?? "-" },
                  ]
                : []),
              { label: "Created by", value: zone.created_by },
              { label: "Created", value: formatDate(zone.created_at) },
            ]}
          />
        </ExpandableSection>

        <Tabs
          activeTabId={activeTab}
          onChange={({ detail }) => setActiveTab(detail.activeTabId)}
          tabs={[
            {
              id: "records",
              label: `Records (${zone.record_count})`,
              content: (
                <Suspense fallback={null}>
                  <RecordsTable zone={zone} onChanged={reload} />
                </Suspense>
              ),
            },
            {
              id: "dnssec",
              label: "DNSSEC signing",
              content: (
                <Box padding="l" textAlign="center" color="text-body-secondary">
                  DNSSEC signing is not available in this Route 53 clone. (Coming soon)
                </Box>
              ),
            },
            {
              id: "tags",
              label: "Hosted zone tags (0)",
              content: (
                <Box padding="l" textAlign="center" color="text-body-secondary">
                  No tags associated with this hosted zone. (Coming soon)
                </Box>
              ),
            },
            {
              id: "history",
              label: "Change history",
              content: <ChangeHistory zoneId={zone.id} />,
            },
          ]}
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
        onDeleted={() => router.push("/hosted-zones")}
      />
    </ContentLayout>
  );
}
