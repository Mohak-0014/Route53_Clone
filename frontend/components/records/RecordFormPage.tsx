"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import Spinner from "@cloudscape-design/components/spinner";
import { useBreadcrumbs } from "@/components/layout/ShellContext";
import { useNotifications } from "@/components/providers/NotificationsProvider";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useWriteAccess } from "@/hooks/useWriteAccess";
import { api, ApiError } from "@/lib/api";
import type { DnsRecord, DnsRecordInput, HostedZone, RecordChange } from "@/types";
import { RecordForm } from "./RecordForm";

/** Shared page frame for "Create record" and "Edit record". */
const RETURN_KEYS = ["search", "type", "page", "pageSize"];

/** The records-table view to return to, from ?back= (only the table's own query keys are kept). */
function returnQuery(back: string | null): string {
  if (!back) return "";
  const kept = new URLSearchParams();
  new URLSearchParams(back).forEach((value, key) => {
    if (RETURN_KEYS.includes(key)) kept.set(key, value);
  });
  const qs = kept.toString();
  return qs ? `?${qs}` : "";
}

export function RecordFormPage(props: { zoneId: string; recordId?: string }) {
  return (
    <Suspense fallback={null}>
      <RecordFormPageContent {...props} />
    </Suspense>
  );
}

function RecordFormPageContent({ zoneId, recordId }: { zoneId: string; recordId?: string }) {
  const router = useRouter();
  const { notifyChange } = useNotifications();
  const isEdit = !!recordId;
  const { deniedReason } = useWriteAccess();
  const [conflict, setConflict] = useState<string | null>(null);
  const zoneHref = `/hosted-zones/${zoneId}${returnQuery(useSearchParams().get("back"))}`;

  const { data, error, loading, reload } = useApiQuery(
    async (): Promise<{ zone: HostedZone; record?: DnsRecord }> => {
      const [zone, record] = await Promise.all([
        api.zones.get(zoneId),
        recordId ? api.records.get(zoneId, recordId) : Promise.resolve(undefined),
      ]);
      return { zone, record };
    },
    [zoneId, recordId],
  );

  const title = isEdit ? "Edit record" : "Create record";
  useBreadcrumbs([
    { text: "Route 53", href: "/dashboard" },
    { text: "Hosted zones", href: "/hosted-zones" },
    { text: data?.zone.name ?? zoneId, href: zoneHref },
    { text: title, href: "#" },
  ]);

  if (!data) {
    if (loading) {
      return (
        <div className="r53-center">
          <Spinner size="large" />
        </div>
      );
    }
    return (
      <Alert
        type="error"
        header={`Unable to load ${isEdit ? "record" : "hosted zone"}`}
        action={<Button onClick={reload}>Retry</Button>}
      >
        {error}
      </Alert>
    );
  }

  const submit = async (inputs: DnsRecordInput[]) => {
    if (isEdit) {
      setConflict(null);
      let saved: RecordChange;
      try {
        saved = await api.records.update(zoneId, recordId!, { ...inputs[0], expected_version: data.record?.version });
      } catch (e) {
        if (e instanceof ApiError && e.code === "ConcurrentModification") {
          setConflict(e.message);
          return false;
        }
        throw e;
      }
      notifyChange(`Record ${saved.name} (${saved.type}) was successfully updated.`, saved.change);
    } else if (inputs.length === 1) {
      const saved = await api.records.create(zoneId, inputs[0]);
      notifyChange(`Record ${saved.name} (${saved.type}) was successfully created.`, saved.change);
    } else {
      const saved = await api.records.createBatch(zoneId, inputs);
      notifyChange(`${saved.records.length} records were successfully created in ${data.zone.name}.`, saved.change);
    }
    router.push(zoneHref);
  };

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description={
            isEdit
              ? `Edit ${data.record?.type} record ${data.record?.name}`
              : `Create a record in ${data.zone.name}. Changes generally propagate to all Route 53 servers within 60 seconds.`
          }
        >
          {title}
        </Header>
      }
    >
      {conflict && (
        <Box margin={{ bottom: "l" }}>
          <Alert
            type="error"
            header="Record was modified"
            action={
              <Button
                onClick={() => {
                  setConflict(null);
                  reload();
                }}
              >
                Reload latest
              </Button>
            }
          >
            {conflict}
          </Alert>
        </Box>
      )}
      {deniedReason && (
        <Box margin={{ bottom: "l" }}>
          <Alert type="info" header="Read-only access">
            You are signed in as a read-only IAM user, so you can view this record but not save changes.
          </Alert>
        </Box>
      )}
      <RecordForm
        deniedReason={deniedReason}
        // Remount with fresh values when a reload brings a newer version of the record.
        key={data.record ? `${data.record.id}:${data.record.version}` : "new"}
        zone={data.zone}
        record={data.record}
        submitLabel={isEdit ? "Save" : "Create records"}
        onSubmit={submit}
        onCancel={() => router.push(zoneHref)}
      />
    </ContentLayout>
  );
}
