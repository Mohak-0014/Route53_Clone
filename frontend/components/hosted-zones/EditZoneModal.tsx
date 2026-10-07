"use client";

import { useEffect, useState } from "react";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Textarea from "@cloudscape-design/components/textarea";
import { useNotifications } from "@/components/providers/NotificationsProvider";
import { api, errorMessage } from "@/lib/api";
import type { HostedZone } from "@/types";

const MAX = 256;

/** Route 53 only lets you change a hosted zone's description after creation. */
export function EditZoneModal({
  zone,
  onDismiss,
  onSaved,
}: {
  zone: HostedZone | null;
  onDismiss: () => void;
  onSaved: (zone: HostedZone) => void;
}) {
  const { notify } = useNotifications();
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (zone) {
      setComment(zone.comment);
      setError(null);
      setBusy(false);
    }
  }, [zone]);

  const save = async () => {
    if (!zone || comment.length > MAX) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.zones.update(zone.id, comment);
      notify({ type: "success", content: `Hosted zone ${updated.name} was successfully updated.` });
      onSaved(updated);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={!!zone}
      onDismiss={onDismiss}
      header="Edit hosted zone"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onDismiss}>
              Cancel
            </Button>
            <Button variant="primary" onClick={save} loading={busy} disabled={comment.length > MAX}>
              Save changes
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        {error && <Alert type="error">{error}</Alert>}
        <FormField label="Domain name" description="You can't change the domain name of an existing hosted zone.">
          <Input value={zone?.name ?? ""} disabled />
        </FormField>
        <FormField
          label={
            <>
              Description - <i>optional</i>
            </>
          }
          description="This value lets you distinguish hosted zones that have the same name."
          constraintText={`The description can have up to ${MAX} characters. ${comment.length}/${MAX}`}
          errorText={comment.length > MAX ? `Description must be ${MAX} characters or fewer.` : undefined}
        >
          <Textarea value={comment} onChange={({ detail }) => setComment(detail.value)} rows={3} />
        </FormField>
      </SpaceBetween>
    </Modal>
  );
}
