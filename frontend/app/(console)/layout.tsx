"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import Spinner from "@cloudscape-design/components/spinner";
import { ConsoleShell } from "@/components/layout/ConsoleShell";
import { useAuth } from "@/components/providers/AuthProvider";

/** Every console page requires a session; unauthenticated users go to sign-in. */
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const { status, signedOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === "unauthenticated") {
      // An expired session returns to this page after sign-in; signing out on purpose starts over.
      router.replace(signedOut ? "/login" : `/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [status, signedOut, pathname, router]);

  if (status !== "authenticated") {
    return (
      <div className="r53-center">
        <Spinner size="large" />
      </div>
    );
  }
  return <ConsoleShell>{children}</ConsoleShell>;
}
