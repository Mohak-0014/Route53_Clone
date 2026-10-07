"use client";

import { use } from "react";
import { notFound } from "next/navigation";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import Icon from "@cloudscape-design/components/icon";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { useBreadcrumbs } from "@/components/layout/ShellContext";
import { useFollow } from "@/hooks/useFollow";
import { MOCK_SECTIONS } from "@/lib/navigation";

/** Placeholder for console sections outside the assignment's scope. */
export default function ComingSoonPage({ params }: { params: Promise<{ section: string[] }> }) {
  const { section } = use(params);
  const slug = section.join("/");
  const info = MOCK_SECTIONS[slug];
  const follow = useFollow();

  useBreadcrumbs([
    { text: "Route 53", href: "/dashboard" },
    { text: info?.title ?? "Not found", href: `/${slug}` },
  ]);

  if (!info) notFound();

  return (
    <ContentLayout header={<Header variant="h1" description={info.description}>{info.title}</Header>}>
      <Container>
        <Box textAlign="center" padding={{ vertical: "xxxl" }}>
          <SpaceBetween size="m">
            <Icon name="status-pending" size="big" variant="subtle" />
            <Box variant="h2">Coming soon</Box>
            <Box color="text-body-secondary">
              {info.title} is not available in this Route 53 clone yet. Hosted zones and DNS record
              management are fully functional.
            </Box>
            <Button href="/hosted-zones" variant="primary" onFollow={follow}>
              Go to hosted zones
            </Button>
          </SpaceBetween>
        </Box>
      </Container>
    </ContentLayout>
  );
}
