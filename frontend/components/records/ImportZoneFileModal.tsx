"use client";

import { useEffect, useState } from "react";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import FileUpload from "@cloudscape-design/components/file-upload";
import FormField from "@cloudscape-design/components/form-field";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Textarea from "@cloudscape-design/components/textarea";
import { useNotifications } from "@/components/providers/NotificationsProvider";
import { api, errorMessage } from "@/lib/api";
import type { ImportResult } from "@/types";

const SAMPLE = `$ORIGIN example.com.
$TTL 300
www      IN  A      192.0.2.1
api  60  IN  A      192.0.2.2
@        IN  MX     10 mail.example.com.
docs     IN  CNAME  example.github.io.`;

/** Bonus: import records from a BIND zone file, like Route 53's "Import zone file". */
export function ImportZoneFileModal({
  zoneId,
  zoneName,
  visible,
  onDismiss,
  onImported,
}: {
  zoneId: string;
  zoneName: string;
  visible: boolean;
  onDismiss: () => void;
  onImported: () => void;
}) {
  const { notify, notifyChange } = useNotifications();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  useEffect(() => {
    if (visible) {
      setText("");
      setFiles([]);
      setError(null);
      setResult(null);
      setBusy(false);
    }
  }, [visible]);

  const onFiles = async (next: File[]) => {
    setFiles(next);
    if (next[0]) setText(await next[0].text());
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.records.importZoneFile(zoneId, text);
      setResult(r);
      if (r.created > 0) {
        const message = `Imported ${r.created} record${r.created === 1 ? "" : "s"} into ${zoneName}.`;
        if (r.change) notifyChange(message, r.change);
        else notify({ type: "success", content: message });
        onImported();
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={visible}
      onDismiss={onDismiss}
      size="large"
      header="Import zone file"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onDismiss}>
              {result ? "Close" : "Cancel"}
            </Button>
            <Button variant="primary" onClick={submit} loading={busy} disabled={!text.trim()}>
              Import
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        <Box color="text-body-secondary">
          Paste a BIND-format zone file or upload one. SOA and apex NS records are ignored because Route 53 manages
          them. Records whose name and type already exist in the hosted zone are skipped.
        </Box>
        <FormField label="Zone file">
          <FileUpload
            value={files}
            onChange={({ detail }) => onFiles(detail.value)}
            accept=".zone,.txt,.db,text/plain"
            i18nStrings={{
              uploadButtonText: () => "Choose file",
              dropzoneText: () => "Drop zone file to upload",
              removeFileAriaLabel: () => "Remove file",
              limitShowFewer: "Show fewer files",
              limitShowMore: "Show more files",
              errorIconAriaLabel: "Error",
            }}
            constraintText="Or paste the contents below."
          />
        </FormField>
        <FormField label="Zone file contents">
          <Textarea
            value={text}
            onChange={({ detail }) => setText(detail.value)}
            rows={12}
            placeholder={SAMPLE}
            spellcheck={false}
          />
        </FormField>
        {error && <Alert type="error">{error}</Alert>}
        {result && (
          <Alert
            type={result.errors.length ? "warning" : "success"}
            header={`Created ${result.created} record set${result.created === 1 ? "" : "s"}, skipped ${result.skipped}.`}
          >
            {result.errors.length > 0 && (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {result.errors.slice(0, 20).map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
          </Alert>
        )}
      </SpaceBetween>
    </Modal>
  );
}
