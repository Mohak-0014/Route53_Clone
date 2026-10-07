"use client";

import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
import { useNotifications } from "@/components/providers/NotificationsProvider";
import { api, errorMessage } from "@/lib/api";
import { downloadFile } from "@/lib/format";
import type { HostedZone } from "@/types";

/** Downloads the zone as a BIND zone file or as Route 53-style JSON. */
export function ExportZoneButton({ zone }: { zone: HostedZone }) {
  const { notify } = useNotifications();

  const exportZone = async (format: "bind" | "json") => {
    try {
      if (format === "bind") {
        downloadFile(`${zone.name}.zone`, await api.zones.exportBind(zone.id), "text/plain");
      } else {
        const json = await api.zones.exportJson(zone.id);
        downloadFile(`${zone.name}.json`, JSON.stringify(json, null, 2), "application/json");
      }
      notify({ type: "success", content: `Exported ${zone.name} as ${format === "bind" ? "a BIND zone file" : "JSON"}.` });
    } catch (e) {
      notify({ type: "error", header: "Export failed", content: errorMessage(e) });
    }
  };

  return (
    <ButtonDropdown
      items={[
        { id: "bind", text: "BIND zone file" },
        { id: "json", text: "JSON" },
      ]}
      onItemClick={({ detail }) => exportZone(detail.id as "bind" | "json")}
    >
      Export zone
    </ButtonDropdown>
  );
}
