"use client";

import { useEffect, useState } from "react";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import { useNotifications } from "@/components/providers/NotificationsProvider";
import { api, errorMessage } from "@/lib/api";
import type { DnsRecord } from "@/types";

export function DeleteRecordsModal({
  zoneId,
  records,
  onDismiss,
  onDeleted,
}: {
  zoneId: string;
  records: DnsRecord[];
  onDismiss: () => void;
  onDeleted: () => void;
}) {
  const { notify, notifyChange } = useNotifications();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const visible = records.length > 0;

  useEffect(() => {
    setBusy(false);
    setError(null);
  }, [records]);

  const protectedRecords = records.filter((r) => r.is_default);
  const deletable = records.filter((r) => !r.is_default);

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const change =
        deletable.length === 1
          ? (await api.records.remove(zoneId, deletable[0].id)).change
          : (await api.records.bulkRemove(zoneId, deletable.map((r) => r.id))).change;
      const message =
        deletable.length === 1
          ? `Record ${deletable[0].name} (${deletable[0].type}) was successfully deleted.`
          : `${deletable.length} records were successfully deleted.`;
      if (change) notifyChange(message, change);
      else notify({ type: "success", content: message });
      onDeleted();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={visible}
      onDismiss={onDismiss}
      header={deletable.length === 1 || records.length === 1 ? "Delete record?" : `Delete ${deletable.length} records?`}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onDismiss}>
              Cancel
            </Button>
            <Button variant="primary" onClick={remove} loading={busy} disabled={deletable.length === 0}>
              Delete
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        {protectedRecords.length > 0 && (
          <Alert type="warning" header="Some records can't be deleted">
            The NS and SOA records for the zone apex are required by Route 53 and can&apos;t be deleted. They will be
            skipped.
          </Alert>
        )}
        {deletable.length > 0 && (
          <>
            <Box>
              Deleting records is permanent. DNS resolvers will stop returning these values after the cached TTL
              expires.
            </Box>
            <Table
              variant="embedded"
              items={deletable}
              columnDefinitions={[
                { id: "name", header: "Record name", cell: (r) => r.name },
                { id: "type", header: "Type", cell: (r) => r.type },
                { id: "value", header: "Value", cell: (r) => <span className="r53-values">{r.values.join("\n")}</span> },
              ]}
            />
          </>
        )}
        {error && <Alert type="error">{error}</Alert>}
      </SpaceBetween>
    </Modal>
  );
}
