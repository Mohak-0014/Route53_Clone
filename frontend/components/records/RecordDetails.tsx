"use client";

import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { formatDate } from "@/lib/format";
import type { DnsRecord } from "@/types";

/** Content of the "Record details" split panel shown when one record is selected. */
export function RecordDetails({
  record,
  onEdit,
  deniedReason,
}: {
  record: DnsRecord;
  onEdit: () => void;
  /** Set when the user may not edit (read-only IAM user); disables the button with this tooltip. */
  deniedReason?: string;
}) {
  return (
    <SpaceBetween size="l">
      <Box float="right">
        <Button onClick={onEdit} disabled={!!deniedReason} disabledReason={deniedReason}>
          Edit record
        </Button>
      </Box>
      <KeyValuePairs
        columns={1}
        items={[
          { label: "Record name", value: record.name },
          { label: "Record type", value: record.type },
          {
            label: "Value",
            value: (
              <Box variant="code" fontSize="body-s">
                <span className="r53-values">{record.values.join("\n")}</span>
              </Box>
            ),
          },
          { label: "Alias", value: record.alias ? "Yes" : "No" },
          { label: "TTL (seconds)", value: String(record.ttl) },
          { label: "Routing policy", value: "Simple" },
          ...(record.comment ? [{ label: "Comment", value: record.comment }] : []),
          { label: "Last modified", value: formatDate(record.updated_at) },
        ]}
      />
    </SpaceBetween>
  );
}
