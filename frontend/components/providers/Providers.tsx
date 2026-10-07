"use client";

import { useEffect } from "react";
import { initTheme } from "@/lib/theme";
import { AuthProvider } from "./AuthProvider";
import { NotificationsProvider } from "./NotificationsProvider";

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => initTheme(), []);
  return (
    <AuthProvider>
      <NotificationsProvider>{children}</NotificationsProvider>
    </AuthProvider>
  );
}
