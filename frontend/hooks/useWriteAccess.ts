"use client";

import { useAuth } from "@/components/providers/AuthProvider";

export const READ_ONLY_REASON = "You don't have permission (read-only IAM user).";

/**
 * Whether the signed-in mock IAM user may change zones and records. Write buttons use
 * `disabled={readOnly}` with `disabledReason={deniedReason}`, which Cloudscape shows as a tooltip.
 * The API enforces the same rule (403 AccessDenied).
 */
export function useWriteAccess() {
  const { user } = useAuth();
  const readOnly = user?.role === "read_only";
  return { readOnly, deniedReason: readOnly ? READ_ONLY_REASON : undefined };
}
