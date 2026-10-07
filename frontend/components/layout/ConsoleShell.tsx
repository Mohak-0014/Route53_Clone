"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import AppLayout from "@cloudscape-design/components/app-layout";
import BreadcrumbGroup, { BreadcrumbGroupProps } from "@cloudscape-design/components/breadcrumb-group";
import Flashbar from "@cloudscape-design/components/flashbar";
import SideNavigation from "@cloudscape-design/components/side-navigation";
import SplitPanel from "@cloudscape-design/components/split-panel";
import { useNotifications } from "@/components/providers/NotificationsProvider";
import { activeHref, NAV_ITEMS } from "@/lib/navigation";
import { ShellContext, SplitPanelConfig } from "./ShellContext";
import { TopNav } from "./TopNav";

const HEADER_ID = "r53-top-nav";

/** The AWS console frame: top navigation, side navigation, breadcrumbs, flashbar and split panel. */
export function ConsoleShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { items: notifications } = useNotifications();
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbGroupProps.Item[]>([]);
  const [splitPanel, setSplitPanelState] = useState<SplitPanelConfig | null>(null);
  const [splitPanelOpen, setSplitPanelOpen] = useState(true);
  const [navOpen, setNavOpen] = useState(true);

  const setSplitPanel = useCallback((panel: SplitPanelConfig | null) => {
    setSplitPanelState(panel);
    if (panel) setSplitPanelOpen(true);
  }, []);

  // Panels belong to the page that opened them.
  useEffect(() => setSplitPanelState(null), [pathname]);

  const follow = useCallback(
    (event: CustomEvent<{ href: string; external?: boolean }>) => {
      if (!event.detail.external && event.detail.href.startsWith("/")) {
        event.preventDefault();
        router.push(event.detail.href);
      }
    },
    [router],
  );

  const ctx = useMemo(() => ({ setBreadcrumbs, setSplitPanel }), [setSplitPanel]);

  return (
    <ShellContext.Provider value={ctx}>
      <div id={HEADER_ID} style={{ position: "sticky", top: 0, zIndex: 1002 }}>
        <TopNav />
      </div>
      <AppLayout
        headerSelector={`#${HEADER_ID}`}
        navigationOpen={navOpen}
        onNavigationChange={({ detail }) => setNavOpen(detail.open)}
        navigation={
          <SideNavigation
            header={{ text: "Route 53", href: "/dashboard" }}
            activeHref={activeHref(pathname)}
            items={NAV_ITEMS}
            onFollow={follow}
          />
        }
        breadcrumbs={
          breadcrumbs.length ? (
            <BreadcrumbGroup items={breadcrumbs} onFollow={follow} ariaLabel="Breadcrumbs" />
          ) : undefined
        }
        notifications={notifications.length ? <Flashbar items={notifications} /> : undefined}
        stickyNotifications
        toolsHide
        splitPanel={
          splitPanel ? (
            <SplitPanel header={splitPanel.header} hidePreferencesButton closeBehavior="hide">
              {splitPanel.content}
            </SplitPanel>
          ) : undefined
        }
        splitPanelOpen={!!splitPanel && splitPanelOpen}
        onSplitPanelToggle={({ detail }) => setSplitPanelOpen(detail.open)}
        splitPanelPreferences={{ position: "side" }}
        content={children}
      />
    </ShellContext.Provider>
  );
}
