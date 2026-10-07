"use client";

import { createContext, useContext, useEffect } from "react";
import type { BreadcrumbGroupProps } from "@cloudscape-design/components/breadcrumb-group";

export interface SplitPanelConfig {
  header: string;
  content: React.ReactNode;
}

export interface ShellContextValue {
  setBreadcrumbs: (items: BreadcrumbGroupProps.Item[]) => void;
  setSplitPanel: (panel: SplitPanelConfig | null) => void;
}

export const ShellContext = createContext<ShellContextValue | null>(null);

export function useShell() {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used inside ConsoleShell");
  return ctx;
}

/** Sets the console breadcrumbs for the current page. Pass a stable key to avoid re-renders. */
export function useBreadcrumbs(items: BreadcrumbGroupProps.Item[]) {
  const { setBreadcrumbs } = useShell();
  const key = JSON.stringify(items);
  useEffect(() => {
    setBreadcrumbs(JSON.parse(key));
  }, [key, setBreadcrumbs]);
}
