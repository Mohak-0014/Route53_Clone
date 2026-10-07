"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";

/**
 * Cloudscape links/buttons render real <a href> elements (so middle-click and
 * "open in new tab" work). This handler turns a normal click into a client-side
 * Next.js navigation instead of a full page load.
 */
export function useFollow() {
  const router = useRouter();
  return useCallback(
    (event: CustomEvent<{ href?: string; external?: boolean }>) => {
      const href = event.detail.href;
      if (href && href.startsWith("/") && !event.detail.external) {
        event.preventDefault();
        router.push(href);
      }
    },
    [router],
  );
}
