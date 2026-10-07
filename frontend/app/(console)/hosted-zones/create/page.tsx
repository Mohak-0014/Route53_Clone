"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Alert from "@cloudscape-design/components/alert";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Textarea from "@cloudscape-design/components/textarea";
import Tiles from "@cloudscape-design/components/tiles";
import { useBreadcrumbs } from "@/components/layout/ShellContext";
import { useNotifications } from "@/components/providers/NotificationsProvider";
import { useWriteAccess } from "@/hooks/useWriteAccess";
import { api, ApiError, errorMessage } from "@/lib/api";
import type { ZoneType } from "@/types";

const REGIONS = [
  ["us-east-1", "US East (N. Virginia)"],
  ["us-east-2", "US East (Ohio)"],
  ["us-west-1", "US West (N. California)"],
  ["us-west-2", "US West (Oregon)"],
  ["ap-south-1", "Asia Pacific (Mumbai)"],
  ["ap-southeast-1", "Asia Pacific (Singapore)"],
  ["ap-southeast-2", "Asia Pacific (Sydney)"],
  ["ap-northeast-1", "Asia Pacific (Tokyo)"],
  ["eu-west-1", "Europe (Ireland)"],
  ["eu-west-2", "Europe (London)"],
  ["eu-central-1", "Europe (Frankfurt)"],
  ["sa-east-1", "South America (São Paulo)"],
].map(([value, label]) => ({ value, label: `${label} | ${value}` }));

const DOMAIN_RE = /^(?=.{1,253}\.?$)(?!-)[a-z0-9_-]{1,63}(?<!-)(\.(?!-)[a-z0-9_-]{1,63}(?<!-))+\.?$/i;
const VPC_RE = /^vpc-[0-9a-f]{8,17}$/;

export default function CreateHostedZonePage() {
  const router = useRouter();
  const { notify } = useNotifications();
  const { readOnly, deniedReason } = useWriteAccess();
  useBreadcrumbs([
    { text: "Route 53", href: "/dashboard" },
    { text: "Hosted zones", href: "/hosted-zones" },
    { text: "Create hosted zone", href: "/hosted-zones/create" },
  ]);

  const [name, setName] = useState("");
  const [comment, setComment] = useState("");
  const [type, setType] = useState<ZoneType>("public");
  const [region, setRegion] = useState(REGIONS[4]);
  const [vpcId, setVpcId] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameError = !name.trim()
    ? "Domain name is required."
    : !DOMAIN_RE.test(name.trim())
      ? "Enter a valid domain name, such as example.com."
      : undefined;
  const commentError = comment.length > 256 ? "Description must be 256 characters or fewer." : undefined;
  const vpcError = type === "private" && !VPC_RE.test(vpcId.trim()) ? "Enter a VPC ID such as vpc-0a1b2c3d." : undefined;

  const submit = async () => {
    setSubmitted(true);
    if (nameError || commentError || vpcError) return;
    setBusy(true);
    setError(null);
    try {
      const zone = await api.zones.create({
        name: name.trim(),
        comment,
        type,
        vpc_region: type === "private" ? region.value : null,
        vpc_id: type === "private" ? vpcId.trim() : null,
      });
      notify({ type: "success", content: `Hosted zone ${zone.name} was successfully created.` });
      router.push(`/hosted-zones/${zone.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description="A hosted zone is a container that holds information about how you want to route traffic for a domain, such as example.com, and its subdomains."
        >
          Create hosted zone
        </Header>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Form
          errorText={error ?? undefined}
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button formAction="none" variant="link" onClick={() => router.push("/hosted-zones")}>
                Cancel
              </Button>
              <Button variant="primary" formAction="submit" loading={busy} disabled={readOnly} disabledReason={deniedReason}>
                Create hosted zone
              </Button>
            </SpaceBetween>
          }
        >
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Hosted zone configuration</Header>}>
              <SpaceBetween size="l">
                <FormField
                  label="Domain name"
                  description="This is the name of the domain that you want to route traffic for."
                  constraintText="Valid characters: a-z, 0-9, hyphen (-), underscore (_) and period (.)"
                  errorText={submitted ? nameError : undefined}
                >
                  <Input
                    value={name}
                    onChange={({ detail }) => setName(detail.value)}
                    placeholder="example.com"
                    autoFocus
                    ariaLabel="Domain name"
                  />
                </FormField>
                <FormField
                  label={
                    <>
                      Description - <i>optional</i>
                    </>
                  }
                  description="This value lets you distinguish hosted zones that have the same name."
                  constraintText={`The description can have up to 256 characters. ${comment.length}/256`}
                  errorText={commentError}
                >
                  <Textarea
                    value={comment}
                    onChange={({ detail }) => setComment(detail.value)}
                    placeholder="The hosted zone is used for..."
                    rows={2}
                  />
                </FormField>
                <FormField label="Type" description="The type indicates whether you want to route traffic on the internet or in an Amazon VPC.">
                  <Tiles
                    value={type}
                    onChange={({ detail }) => setType(detail.value as ZoneType)}
                    columns={2}
                    items={[
                      {
                        value: "public",
                        label: "Public hosted zone",
                        description: "A public hosted zone determines how traffic is routed on the internet.",
                      },
                      {
                        value: "private",
                        label: "Private hosted zone",
                        description: "A private hosted zone determines how traffic is routed within an Amazon VPC.",
                      },
                    ]}
                  />
                </FormField>
              </SpaceBetween>
            </Container>

            {type === "private" && (
              <Container
                header={
                  <Header
                    variant="h2"
                    description="To use this hosted zone to resolve DNS queries for one or more VPCs, choose the VPCs."
                  >
                    VPCs to associate with the hosted zone
                  </Header>
                }
              >
                <SpaceBetween size="l">
                  <Alert type="info">
                    To use private hosted zones, you must set the following Amazon VPC settings to true:
                    enableDnsHostnames and enableDnsSupport.
                  </Alert>
                  <FormField label="Region">
                    <Select
                      selectedOption={region}
                      onChange={({ detail }) => setRegion(detail.selectedOption as typeof region)}
                      options={REGIONS}
                    />
                  </FormField>
                  <FormField label="VPC ID" errorText={submitted ? vpcError : undefined}>
                    <Input
                      value={vpcId}
                      onChange={({ detail }) => setVpcId(detail.value)}
                      placeholder="vpc-0a1b2c3d4e5f67890"
                    />
                  </FormField>
                </SpaceBetween>
              </Container>
            )}
          </SpaceBetween>
        </Form>
      </form>
    </ContentLayout>
  );
}
