"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ButtonDropdown, { ButtonDropdownProps } from "@cloudscape-design/components/button-dropdown";
import TopNavigation from "@cloudscape-design/components/top-navigation";
import { useAuth } from "@/components/providers/AuthProvider";
import { useNotifications } from "@/components/providers/NotificationsProvider";
import { getTheme, setTheme, ThemeMode } from "@/lib/theme";
import { ConsoleSearch } from "./ConsoleSearch";

/** The AWS "Services" menu. Only Route 53 exists in this clone. */
const SERVICES: ButtonDropdownProps.ItemOrGroup[] = [
  {
    id: "networking",
    text: "Networking & Content Delivery",
    items: [
      { id: "route53", text: "Route 53", href: "/hosted-zones" },
      { id: "cloudfront", text: "CloudFront", disabled: true, disabledReason: "Not part of this clone" },
      { id: "vpc", text: "VPC", disabled: true, disabledReason: "Not part of this clone" },
    ],
  },
  {
    id: "recent",
    text: "Recently visited",
    items: [
      { id: "zones", text: "Route 53 · Hosted zones", href: "/hosted-zones" },
      { id: "health", text: "Route 53 · Health checks", href: "/health-checks" },
    ],
  },
];

function formatAccountId(id: string) {
  return id.length === 12 ? `${id.slice(0, 4)}-${id.slice(4, 8)}-${id.slice(8)}` : id;
}

export function TopNav() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { notify } = useNotifications();
  const [mode, setMode] = useState<ThemeMode>("light");

  useEffect(() => setMode(getTheme()), []);

  const toggleMode = () => {
    const next = mode === "dark" ? "light" : "dark";
    setTheme(next);
    setMode(next);
  };

  return (
    <TopNavigation
      identity={{
        href: "/hosted-zones",
        title: "",
        logo: { src: "/route53-icon.svg", alt: "Route 53" },
        onFollow: (e) => {
          e.preventDefault();
          router.push("/hosted-zones");
        },
      }}
      search={
        <div className="r53-top-search">
          <ButtonDropdown
            items={SERVICES}
            onItemClick={({ detail }) => {
              if (detail.href) router.push(detail.href);
            }}
            onItemFollow={({ detail, preventDefault }) => {
              preventDefault();
              if (detail.href) router.push(detail.href);
            }}
            ariaLabel="Services"
            expandToViewport
          >
            Services
          </ButtonDropdown>
          <ConsoleSearch />
        </div>
      }
      utilities={[
        {
          type: "menu-dropdown",
          iconName: "script",
          ariaLabel: "CloudShell",
          title: "CloudShell",
          items: [{ id: "cloudshell", text: "CloudShell is not available in this Route 53 clone", disabled: true }],
        },
        {
          type: "menu-dropdown",
          iconName: "notification",
          ariaLabel: "Notifications",
          title: "Notifications",
          items: [{ id: "none", text: "No new notifications", disabled: true }],
        },
        {
          type: "menu-dropdown",
          iconName: "support",
          ariaLabel: "Help",
          title: "Help",
          items: [
            {
              id: "docs",
              text: "Route 53 documentation",
              href: "https://docs.aws.amazon.com/route53/",
              external: true,
              externalIconAriaLabel: " (opens in a new tab)",
            },
            {
              id: "record-types",
              text: "Supported DNS record types",
              href: "https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/ResourceRecordTypes.html",
              external: true,
              externalIconAriaLabel: " (opens in a new tab)",
            },
            { id: "shortcuts", text: "Keyboard shortcuts: Alt+S search, / filter tables", disabled: true },
          ],
        },
        {
          type: "button",
          text: "Global",
          iconName: "globe",
          ariaLabel: "Region: Global. Route 53 is a global service.",
          title: "Route 53 does not require a region selection",
        },
        {
          type: "menu-dropdown",
          iconName: "settings",
          ariaLabel: "Settings",
          title: "Settings",
          items: [
            {
              id: "theme",
              text: mode === "dark" ? "Visual mode: Dark (switch to light)" : "Visual mode: Light (switch to dark)",
            },
          ],
          onItemClick: ({ detail }) => {
            if (detail.id === "theme") toggleMode();
          },
        },
        {
          type: "menu-dropdown",
          text: user ? `${user.username} @ ${formatAccountId(user.account_id)}` : "",
          description: user
            ? `Account ID: ${formatAccountId(user.account_id)} · Role: ${user.role === "read_only" ? "Read-only" : "Administrator"}`
            : undefined,
          iconName: "user-profile",
          items: [
            { id: "account", text: "Account", href: "/account" },
            { id: "organization", text: "Organization", href: "/organization" },
            { id: "service-quotas", text: "Service Quotas", href: "/service-quotas" },
            { id: "billing", text: "Billing and Cost Management", href: "/billing" },
            { id: "security-credentials", text: "Security credentials", href: "/security-credentials" },
            { id: "signout", text: "Sign out" },
          ],
          onItemFollow: (event) => {
            const href = event.detail.href;
            if (href && href.startsWith("/")) {
              event.preventDefault();
              router.push(href);
            }
          },
          onItemClick: async ({ detail }) => {
            if (detail.id === "signout") {
              await logout();
              notify({ type: "success", content: "You have signed out." });
              router.replace("/login");
            }
          },
        },
      ]}
      i18nStrings={{ overflowMenuTriggerText: "More", overflowMenuTitleText: "All" }}
    />
  );
}
