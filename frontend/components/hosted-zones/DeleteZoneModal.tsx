"use client";

import { useEffect, useState } from "react";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { useNotifications } from "@/components/providers/NotificationsProvider";
import { api, errorMessage } from "@/lib/api";
import type { HostedZone } from "@/types";

const CONFIRM_WORD = "delete";

export function DeleteZoneModal({
  zone,
  onDismiss,
  onDeleted,
}: {
  zone: HostedZone | null;
  onDismiss: () => void;
  onDeleted: (zone: HostedZone) => void;
}) {
  const { notify } = useNotifications();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setConfirm("");
    setError(null);
    setBusy(false);
  }, [zone]);

  // Every zone keeps its apex SOA + NS records; anything beyond those blocks deletion.
  const extraRecords = zone ? Math.max(0, zone.record_count - 2) : 0;

  const remove = async () => {
    if (!zone) return;
    setBusy(true);
    setError(null);
    try {
      await api.zones.remove(zone.id);
      notify({ type: "success", content: `Hosted zone ${zone.name} was successfully deleted.` });
      onDeleted(zone);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={!!zone}
      onDismiss={onDismiss}
      header={`Delete hosted zone ${zone?.name ?? ""}?`}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onDismiss}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={remove}
              loading={busy}
              disabled={confirm !== CONFIRM_WORD || extraRecords > 0}
            >
              Delete
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        {extraRecords > 0 ? (
          <Alert type="warning" header="This hosted zone contains records">
            To delete this hosted zone, you must first delete all records except the NS and SOA records that Route
            53 created automatically. <b>{zone?.name}</b> has {extraRecords} other record
            {extraRecords === 1 ? "" : "s"}.
          </Alert>
        ) : (
          <Box>
            Permanently delete hosted zone <b>{zone?.name}</b>? You can&apos;t undo this action. DNS queries for this
            domain will no longer be answered by these name servers.
          </Box>
        )}
        {error && <Alert type="error">{error}</Alert>}
        <FormField label={`To confirm deletion, type "${CONFIRM_WORD}" in the field.`}>
          <Input
            value={confirm}
            onChange={({ detail }) => setConfirm(detail.value)}
            placeholder={CONFIRM_WORD}
            disabled={extraRecords > 0}
            ariaLabel="Confirm deletion"
          />
        </FormField>
      </SpaceBetween>
    </Modal>
  );
}
