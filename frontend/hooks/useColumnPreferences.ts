"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The visible columns of a table, remembered in this browser (like the Route 53 console's
 * table preferences). Saved IDs that no longer exist are dropped; if nothing valid is
 * saved, or storage is unavailable, the defaults are used.
 */
export function useColumnPreferences(table: string, allColumns: readonly string[], defaults: readonly string[]) {
  const key = `r53.columns.${table}`;
  const [visible, setVisible] = useState<readonly string[]>(defaults);

  // Read after mount so the server render and the first client render match.
  const known = allColumns.join(",");
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(window.localStorage.getItem(key) ?? "null");
      if (Array.isArray(saved)) {
        const ids = known.split(",");
        const valid = saved.filter((id): id is string => typeof id === "string" && ids.includes(id));
        if (valid.length) setVisible(valid);
      }
    } catch {
      /* storage unavailable or corrupt: keep the defaults */
    }
  }, [key, known]);

  const save = useCallback(
    (ids: readonly string[]) => {
      setVisible(ids);
      try {
        window.localStorage.setItem(key, JSON.stringify(ids));
      } catch {
        /* storage unavailable: the choice still applies until the page is left */
      }
    },
    [key],
  );

  return [visible, save] as const;
}
