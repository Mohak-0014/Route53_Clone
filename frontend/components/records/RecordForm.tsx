"use client";

import { useMemo, useRef, useState } from "react";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Grid from "@cloudscape-design/components/grid";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Select, { SelectProps } from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Textarea from "@cloudscape-design/components/textarea";
import Toggle from "@cloudscape-design/components/toggle";
import { RECORD_TYPE_INFO } from "@/lib/format";
import { validateRecordName, validateValueLine } from "@/lib/recordValidation";
import { DnsRecord, DnsRecordInput, HostedZone, RECORD_TYPES, RecordType } from "@/types";

const TTL_PRESETS = [
  { label: "1m", value: 60 },
  { label: "1h", value: 3600 },
  { label: "1d", value: 86400 },
];
const MAX_RECORDS = 50;

function typeOption(t: RecordType): SelectProps.Option {
  return { value: t, label: t, description: RECORD_TYPE_INFO[t].description };
}

/** The record name the console shows in the input: the part before the zone name. */
function relativeName(fqdn: string, zone: string) {
  if (fqdn === zone) return "";
  return fqdn.endsWith("." + zone) ? fqdn.slice(0, -(zone.length + 1)) : fqdn;
}

interface Entry {
  key: number;
  name: string;
  type: RecordType;
  value: string;
  ttl: string;
  comment: string;
}

function entryErrors(e: Entry) {
  const lines = e.value.split("\n").map((l) => l.trim()).filter(Boolean);
  const ttlNum = Number(e.ttl);
  return {
    lines,
    ttlNum,
    name: validateRecordName(e.name),
    ttl:
      e.ttl.trim() === "" || !Number.isInteger(ttlNum) || ttlNum < 0 || ttlNum > 2147483647
        ? "TTL must be a whole number of seconds between 0 and 2147483647."
        : null,
    value: !lines.length
      ? "Enter a value."
      : e.type === "CNAME" && lines.length > 1
        ? "A CNAME record can have only one value."
        : (lines.map((l) => validateValueLine(e.type, l)).find(Boolean) ?? null),
  };
}

/**
 * Route 53's "Quick create record" form. Creating supports several records submitted as
 * one batch ("Add another record"); editing works on a single record.
 */
export function RecordForm({
  zone,
  record,
  submitLabel,
  onSubmit,
  onCancel,
  deniedReason,
}: {
  zone: HostedZone;
  record?: DnsRecord;
  submitLabel: string;
  /** Resolve `false` to stay on the form (e.g. the page is showing its own error). */
  onSubmit: (inputs: DnsRecordInput[]) => Promise<boolean | void>;
  onCancel: () => void;
  /** Set for read-only IAM users: the submit button is disabled with this tooltip. */
  deniedReason?: string;
}) {
  const nextKey = useRef(1);
  const blank = (): Entry => ({ key: nextKey.current++, name: "", type: "A", value: "", ttl: "300", comment: "" });
  const [entries, setEntries] = useState<Entry[]>(() =>
    record
      ? [
          {
            key: 0,
            name: relativeName(record.name, zone.name),
            type: record.type,
            value: record.values.join("\n"),
            ttl: String(record.ttl),
            comment: record.comment ?? "",
          },
        ]
      : [blank()],
  );
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const update = (key: number, patch: Partial<Entry>) =>
    setEntries((prev) => prev.map((e) => (e.key === key ? { ...e, ...patch } : e)));

  const submit = async () => {
    setSubmitted(true);
    const checked = entries.map(entryErrors);
    if (checked.some((c) => c.name || c.ttl || c.value)) return;
    setBusy(true);
    setServerError(null);
    try {
      const done = await onSubmit(
        entries.map((e, i) => ({
          name: e.name.trim(),
          type: e.type,
          ttl: checked[i].ttlNum,
          values: checked[i].lines,
          comment: e.comment,
        })),
      );
      if (done === false) setBusy(false);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  };

  const multiple = entries.length > 1;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Form
        errorText={serverError ?? undefined}
        errorIconAriaLabel="Error"
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button formAction="none" variant="link" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              formAction="submit"
              variant="primary"
              loading={busy}
              disabled={!!deniedReason}
              disabledReason={deniedReason}
            >
              {submitLabel}
            </Button>
          </SpaceBetween>
        }
      >
        <SpaceBetween size="l">
          {entries.map((entry, i) => (
            <RecordFields
              key={entry.key}
              zone={zone}
              entry={entry}
              title={multiple ? `Record ${i + 1}` : "Record"}
              isDefault={!!record?.is_default}
              autoFocus={!record && i === entries.length - 1}
              showErrors={submitted}
              onChange={(patch) => update(entry.key, patch)}
              onRemove={multiple ? () => setEntries((prev) => prev.filter((e) => e.key !== entry.key)) : undefined}
            />
          ))}
          {!record && (
            <Button
              formAction="none"
              iconName="add-plus"
              disabled={entries.length >= MAX_RECORDS}
              onClick={() => setEntries((prev) => [...prev, blank()])}
            >
              Add another record
            </Button>
          )}
        </SpaceBetween>
      </Form>
    </form>
  );
}

function RecordFields({
  zone,
  entry,
  title,
  isDefault,
  autoFocus,
  showErrors,
  onChange,
  onRemove,
}: {
  zone: HostedZone;
  entry: Entry;
  title: string;
  isDefault: boolean;
  autoFocus: boolean;
  showErrors: boolean;
  onChange: (patch: Partial<Entry>) => void;
  onRemove?: () => void;
}) {
  const { type } = entry;
  const info = RECORD_TYPE_INFO[type];
  const errors = entryErrors(entry);
  const show = (err: string | null) => (showErrors && err ? err : undefined);
  const typeOptions = useMemo(
    () => (type === "SOA" ? [typeOption("SOA")] : RECORD_TYPES.map((t) => typeOption(t))),
    [type],
  );

  return (
    <Container
      header={
        <Header
          variant="h2"
          description="Route 53 responds to DNS queries for this record with the values you specify."
          actions={
            onRemove && (
              <Button formAction="none" onClick={onRemove} ariaLabel={`Delete ${title}`}>
                Delete
              </Button>
            )
          }
        >
          {title}
        </Header>
      }
    >
      <SpaceBetween size="l">
        {isDefault && (
          <Alert type="info">
            This {type} record was created automatically by Route 53. You can change its values and TTL, but not its
            name or type.
          </Alert>
        )}
        <ColumnLayout columns={2}>
          <FormField
            label="Record name"
            description="Keep blank to create a record for the root domain."
            errorText={show(errors.name)}
          >
            <Grid gridDefinition={[{ colspan: 7 }, { colspan: 5 }]}>
              <Input
                value={entry.name}
                onChange={({ detail }) => onChange({ name: detail.value })}
                placeholder="subdomain"
                disabled={isDefault}
                ariaLabel="Record name"
                autoFocus={autoFocus}
              />
              <Box padding={{ top: "xxs" }} color="text-body-secondary">
                <span style={{ wordBreak: "break-all" }}>.{zone.name}</span>
              </Box>
            </Grid>
          </FormField>
          <FormField label="Record type" description="The DNS type of the record determines the format of the value.">
            <Select
              selectedOption={typeOption(type)}
              onChange={({ detail }) => onChange({ type: detail.selectedOption.value as RecordType })}
              options={typeOptions}
              disabled={isDefault}
              ariaLabel="Record type"
              triggerVariant="option"
            />
          </FormField>
        </ColumnLayout>

        <Toggle checked={false} disabled description="Alias records route traffic to AWS resources and aren't supported in this clone.">
          Alias
        </Toggle>

        <FormField
          label="Value"
          description={info.hint}
          constraintText={type === "TXT" ? "Values without quotation marks are quoted automatically." : undefined}
          errorText={show(errors.value)}
          stretch
        >
          <Textarea
            value={entry.value}
            onChange={({ detail }) => onChange({ value: detail.value })}
            placeholder={info.placeholder}
            rows={Math.min(Math.max(errors.lines.length + 1, 3), 10)}
            spellcheck={false}
            ariaLabel="Value"
          />
        </FormField>

        <ColumnLayout columns={2}>
          <FormField
            label="TTL (seconds)"
            description="The amount of time, in seconds, that DNS resolvers cache this record."
            constraintText="Recommended values: 60 to 172800 (two days)"
            errorText={show(errors.ttl)}
          >
            <Grid gridDefinition={[{ colspan: 5 }, { colspan: 7 }]}>
              <Input
                type="number"
                inputMode="numeric"
                value={entry.ttl}
                onChange={({ detail }) => onChange({ ttl: detail.value })}
                ariaLabel="TTL"
              />
              <SpaceBetween direction="horizontal" size="xxs">
                {TTL_PRESETS.map((p) => (
                  <Button key={p.label} formAction="none" onClick={() => onChange({ ttl: String(p.value) })}>
                    {p.label}
                  </Button>
                ))}
              </SpaceBetween>
            </Grid>
          </FormField>
          <FormField label="Routing policy" description="Determines how Route 53 responds to queries.">
            <Select
              selectedOption={{ value: "simple", label: "Simple routing" }}
              options={[{ value: "simple", label: "Simple routing" }]}
              onChange={() => undefined}
              ariaLabel="Routing policy"
            />
          </FormField>
        </ColumnLayout>

        <FormField
          label={
            <>
              Comment - <i>optional</i>
            </>
          }
          constraintText="Up to 256 characters."
        >
          <Input value={entry.comment} onChange={({ detail }) => onChange({ comment: detail.value.slice(0, 256) })} />
        </FormField>
      </SpaceBetween>
    </Container>
  );
}
