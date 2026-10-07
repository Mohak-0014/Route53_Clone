"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Grid from "@cloudscape-design/components/grid";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import Select, { SelectProps } from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import { useBreadcrumbs } from "@/components/layout/ShellContext";
import { useApiQuery } from "@/hooks/useApiQuery";
import { api, errorMessage } from "@/lib/api";
import { RECORD_TYPE_INFO } from "@/lib/format";
import { validateRecordName } from "@/lib/recordValidation";
import { RECORD_TYPES, RecordType, ResourceRecordAnswer, TestRecordResult } from "@/types";

const TYPE_OPTIONS: SelectProps.Option[] = [...RECORD_TYPES, "SOA" as const].map((t) => ({
  value: t,
  label: t,
  description: RECORD_TYPE_INFO[t].description,
}));

function rrLines(rrs: ResourceRecordAnswer[]) {
  return rrs.map((a) => `${a.name} ${a.ttl} ${a.type} ${a.value}`).join("\n");
}

/** Route 53's "Test record": the DNS response Route 53 would return for a record name and type. */
export default function TestRecordPage({ params }: { params: Promise<{ zoneId: string }> }) {
  const { zoneId } = use(params);
  const router = useRouter();
  const zoneHref = `/hosted-zones/${zoneId}`;
  const { data: zone, error: zoneError, loading, reload } = useApiQuery(() => api.zones.get(zoneId), [zoneId]);

  const [name, setName] = useState("");
  const [type, setType] = useState<SelectProps.Option>(TYPE_OPTIONS[0]);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TestRecordResult | null>(null);

  useBreadcrumbs([
    { text: "Route 53", href: "/dashboard" },
    { text: "Hosted zones", href: "/hosted-zones" },
    { text: zone?.name ?? zoneId, href: zoneHref },
    { text: "Test record", href: `${zoneHref}/test-record` },
  ]);

  if (!zone) {
    if (loading) {
      return (
        <div className="r53-center">
          <Spinner size="large" />
        </div>
      );
    }
    return (
      <Alert type="error" header="Unable to load hosted zone" action={<Button onClick={reload}>Retry</Button>}>
        {zoneError}
      </Alert>
    );
  }

  // A trailing dot marks a fully qualified name, which the API checks against the zone.
  const nameError = validateRecordName(name.trim().replace(/\.$/, ""));

  const submit = async () => {
    setSubmitted(true);
    if (nameError) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await api.zones.testRecord(zoneId, name.trim(), type.value as RecordType));
    } catch (e) {
      setError(errorMessage(e));
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description="Route 53 responds to the DNS query with the values in the record that matches the name and type that you specify."
        >
          Test record
        </Header>
      }
    >
      <SpaceBetween size="l">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Form
            errorText={error ?? undefined}
            errorIconAriaLabel="Error"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button formAction="none" variant="link" onClick={() => router.push(zoneHref)}>
                  Cancel
                </Button>
                <Button formAction="submit" variant="primary" loading={busy}>
                  Get response
                </Button>
              </SpaceBetween>
            }
          >
            <Container header={<Header variant="h2">Record to test</Header>}>
              <ColumnLayout columns={2}>
                <FormField
                  label="Record name"
                  description="Keep blank to test the record for the root domain."
                  errorText={submitted && nameError ? nameError : undefined}
                >
                  <Grid gridDefinition={[{ colspan: 7 }, { colspan: 5 }]}>
                    <Input
                      value={name}
                      onChange={({ detail }) => setName(detail.value)}
                      placeholder="subdomain"
                      ariaLabel="Record name"
                      autoFocus
                    />
                    <Box padding={{ top: "xxs" }} color="text-body-secondary">
                      <span style={{ wordBreak: "break-all" }}>.{zone.name}</span>
                    </Box>
                  </Grid>
                </FormField>
                <FormField label="Type">
                  <Select
                    selectedOption={type}
                    onChange={({ detail }) => setType(detail.selectedOption)}
                    options={TYPE_OPTIONS}
                    ariaLabel="Type"
                    triggerVariant="option"
                  />
                </FormField>
              </ColumnLayout>
            </Container>
          </Form>
        </form>

        {result && (
          <Container header={<Header variant="h2">Response returned by Route 53</Header>}>
            <KeyValuePairs
              columns={2}
              items={[
                { label: "DNS query sent to Route 53 servers", value: `${result.query_name} ${result.query_type}` },
                {
                  label: "DNS response code",
                  value: (
                    <StatusIndicator type={result.response_code === "NOERROR" ? "success" : "error"}>
                      {result.response_code === "NOERROR" ? "No error (NOERROR)" : "Non-existent domain (NXDOMAIN)"}
                    </StatusIndicator>
                  ),
                },
                { label: "Protocol", value: result.protocol },
                {
                  label: "Response returned",
                  value: result.answers.length ? (
                    <Box variant="code" fontSize="body-s">
                      <span className="r53-values">{result.answers.map((a) => a.value).join("\n")}</span>
                    </Box>
                  ) : (
                    "-"
                  ),
                },
                ...(result.answers.length
                  ? [
                      {
                        label: "Answer section",
                        value: (
                          <Box variant="code" fontSize="body-s">
                            <span className="r53-values">{rrLines(result.answers)}</span>
                          </Box>
                        ),
                      },
                    ]
                  : []),
                ...(result.authority.length
                  ? [
                      {
                        label: "Authority section",
                        value: (
                          <Box variant="code" fontSize="body-s">
                            <span className="r53-values">{rrLines(result.authority)}</span>
                          </Box>
                        ),
                      },
                    ]
                  : []),
                ...(result.notes.length
                  ? [{ label: "Notes", value: <span className="r53-values">{result.notes.join("\n")}</span> }]
                  : []),
              ]}
            />
          </Container>
        )}
      </SpaceBetween>
    </ContentLayout>
  );
}
