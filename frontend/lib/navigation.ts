import type { SideNavigationProps } from "@cloudscape-design/components/side-navigation";

/** Mocked console sections, rendered by the catch-all "Coming soon" route. */
export const MOCK_SECTIONS: Record<string, { title: string; description: string }> = {
  dashboard: {
    title: "Route 53 Dashboard",
    description: "An overview of your DNS management, traffic management, availability monitoring and domain registration.",
  },
  "health-checks": {
    title: "Health checks",
    description: "Monitor the health and performance of your web applications, web servers and other resources.",
  },
  profiles: {
    title: "Profiles",
    description: "Share DNS settings such as hosted zone associations and Resolver rules across VPCs.",
  },
  "cidr-collections": {
    title: "CIDR collections",
    description: "Route traffic based on the IP address of the client that makes the DNS query.",
  },
  "traffic-policies": {
    title: "Traffic policies",
    description: "Create complex routing configurations using a visual editor.",
  },
  "policy-records": {
    title: "Policy records",
    description: "Associate traffic policies with domain names in your hosted zones.",
  },
  "registered-domains": {
    title: "Registered domains",
    description: "Register and manage domain names.",
  },
  "domain-requests": {
    title: "Requests",
    description: "Track the status of domain registration and transfer requests.",
  },
  "resolver/vpcs": { title: "VPCs", description: "Configure Route 53 Resolver for your VPCs." },
  "resolver/inbound-endpoints": {
    title: "Inbound endpoints",
    description: "Forward DNS queries from your network to Route 53 Resolver.",
  },
  "resolver/outbound-endpoints": {
    title: "Outbound endpoints",
    description: "Forward DNS queries from your VPCs to your network.",
  },
  "resolver/rules": { title: "Rules", description: "Specify which DNS queries are forwarded to your network." },
  "resolver/query-logging": {
    title: "Query logging",
    description: "Log the DNS queries that originate in your VPCs.",
  },
  "dns-firewall/rule-groups": {
    title: "DNS Firewall rule groups",
    description: "Filter and regulate outbound DNS traffic for your VPCs.",
  },
};

const link = (text: string, href: string): SideNavigationProps.Link => ({ type: "link", text, href });

export const NAV_ITEMS: SideNavigationProps.Item[] = [
  link("Dashboard", "/dashboard"),
  link("Hosted zones", "/hosted-zones"),
  link("Health checks", "/health-checks"),
  link("Profiles", "/profiles"),
  {
    type: "section",
    text: "IP-based routing",
    items: [link("CIDR collections", "/cidr-collections")],
  },
  {
    type: "section",
    text: "Traffic flow",
    items: [link("Traffic policies", "/traffic-policies"), link("Policy records", "/policy-records")],
  },
  {
    type: "section",
    text: "Domains",
    items: [link("Registered domains", "/registered-domains"), link("Requests", "/domain-requests")],
  },
  {
    type: "section",
    text: "Resolver",
    items: [
      link("VPCs", "/resolver/vpcs"),
      link("Inbound endpoints", "/resolver/inbound-endpoints"),
      link("Outbound endpoints", "/resolver/outbound-endpoints"),
      link("Rules", "/resolver/rules"),
      link("Query logging", "/resolver/query-logging"),
    ],
  },
  {
    type: "section",
    text: "DNS Firewall",
    items: [link("Rule groups", "/dns-firewall/rule-groups")],
  },
];

/** Every side-navigation link, flattened (used by the console search). */
export const NAV_LINKS: SideNavigationProps.Link[] = NAV_ITEMS.flatMap((item) =>
  item.type === "link" ? [item] : item.type === "section" ? (item.items as SideNavigationProps.Link[]) : [],
);

/** Highlight the closest nav entry for nested pages (e.g. a zone's records → Hosted zones). */
export function activeHref(pathname: string): string {
  if (pathname.startsWith("/hosted-zones")) return "/hosted-zones";
  return pathname;
}
