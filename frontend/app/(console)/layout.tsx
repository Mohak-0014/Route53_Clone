"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Box from "@cloudscape-design/components/box";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import { ConsoleShell } from "@/components/layout/ConsoleShell";
import { useAuth } from "@/components/providers/AuthProvider";

/** After this long, explain that the free-tier demo server may be waking up. */
const SLOW_START_MS = 4000;

/** Every console page requires a session; unauthenticated users go to sign-in. */
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const { status, signedOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (status !== "loading") return;
    const timer = setTimeout(() => setSlow(true), SLOW_START_MS);
    return () => clearTimeout(timer);
  }, [status]);

  useEffect(() => {
    if (status === "unauthenticated") {
      // An expired session returns to this page after sign-in; signing out on purpose starts over.
      router.replace(signedOut ? "/login" : `/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [status, signedOut, pathname, router]);

  if (status !== "authenticated") {
    return (
      <div className="r53-center">
        <SpaceBetween size="m" alignItems="center">
          <Spinner size="large" />
          {slow && status === "loading" && (
            <Box color="text-body-secondary">
              Starting the demo server… this can take up to a minute after a period of inactivity.
            </Box>
          )}
        </SpaceBetween>
      </div>
    );
  }
  return <ConsoleShell>{children}</ConsoleShell>;
}
