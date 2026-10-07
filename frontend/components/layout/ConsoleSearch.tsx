"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Autosuggest, { AutosuggestProps } from "@cloudscape-design/components/autosuggest";
import { api } from "@/lib/api";
import { NAV_LINKS } from "@/lib/navigation";

/**
 * The console-wide search box (Alt+S), as in the AWS top bar. Matches console pages
 * locally and hosted zones through the API; Enter on free text filters the zone list.
 */
export function ConsoleSearch() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [zones, setZones] = useState<AutosuggestProps.Option[]>([]);
  const [status, setStatus] = useState<AutosuggestProps.StatusType>("finished");
  const requestId = useRef(0);
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        wrapper.current?.querySelector("input")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const loadZones = async (text: string) => {
    const id = ++requestId.current;
    if (!text.trim()) {
      setZones([]);
      setStatus("finished");
      return;
    }
    setStatus("loading");
    try {
      const page = await api.zones.list({ search: text.trim(), page_size: 5 });
      if (id !== requestId.current) return;
      setZones(page.items.map((z) => ({ value: `/hosted-zones/${z.id}`, label: z.name, description: z.id, tags: [z.type] })));
      setStatus("finished");
    } catch {
      if (id === requestId.current) setStatus("error");
    }
  };

  const needle = value.trim().toLowerCase();
  const pages = needle
    ? NAV_LINKS.filter((l) => l.text.toLowerCase().includes(needle)).map((l) => ({
        value: l.href,
        label: l.text,
        description: "Route 53 feature",
      }))
    : [];
  const options: AutosuggestProps.Options = [
    ...(pages.length ? [{ label: "Features", options: pages }] : []),
    ...(zones.length ? [{ label: "Hosted zones", options: zones }] : []),
  ];

  const go = (href: string) => {
    setValue("");
    setZones([]);
    router.push(href);
  };

  return (
    <div ref={wrapper} className="r53-console-search">
      <Autosuggest
        value={value}
        onChange={({ detail }) => setValue(detail.value)}
        onLoadItems={({ detail }) => loadZones(detail.filteringText)}
        onSelect={({ detail }) => {
          if (detail.selectedOption?.value) go(detail.selectedOption.value);
          else if (detail.value.trim()) go(`/hosted-zones?search=${encodeURIComponent(detail.value.trim())}`);
        }}
        options={options}
        filteringType="manual"
        statusType={status}
        loadingText="Searching hosted zones"
        errorText="Search is unavailable right now."
        empty="No matching features or hosted zones"
        enteredTextLabel={(v) => `Search hosted zones for "${v}"`}
        placeholder="Search"
        ariaLabel="Search the console"
        expandToViewport
      />
      <kbd className="r53-console-search-hint" aria-hidden>
        [Alt+S]
      </kbd>
    </div>
  );
}
