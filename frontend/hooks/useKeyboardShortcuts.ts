"use client";

import { useEffect, useRef } from "react";

export interface Shortcut {
  /** `KeyboardEvent.key` value ("c", "/", "?", "Delete", "Escape"), or a two-key sequence such as "g h". */
  key: string;
  description: string;
  handler: () => void;
}

const SEQUENCE_TIMEOUT_MS = 1000;
// Inputs you don't type text into: table selection checkboxes/radios must not swallow shortcuts.
const NON_TEXT_INPUTS = new Set(["checkbox", "radio", "button", "submit", "reset", "image", "file", "range", "color"]);

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  return el.tagName === "INPUT" && !NON_TEXT_INPUTS.has((el as HTMLInputElement).type);
}

/** Cloudscape modals render role="dialog" and stay in the DOM while hidden; only count visible ones. */
function modalOpen(): boolean {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).some(
    (d) => d.getClientRects().length > 0,
  );
}

/**
 * Register page keyboard shortcuts. Keys are ignored while typing in a text field, while a
 * modal is open, or when Ctrl/Meta/Alt is held. Handlers always see the latest render's state.
 */
export function useKeyboardShortcuts(shortcuts: Shortcut[]) {
  const latest = useRef(shortcuts);
  latest.current = shortcuts;
  const pending = useRef<{ key: string; at: number } | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTyping(e.target) || modalOpen()) return;

      const list = latest.current;
      const now = Date.now();
      const prefix = pending.current && now - pending.current.at <= SEQUENCE_TIMEOUT_MS ? pending.current.key : null;
      pending.current = null;

      if (prefix) {
        const sequence = list.find((s) => s.key === `${prefix} ${e.key}`);
        if (sequence) {
          e.preventDefault();
          sequence.handler();
          return;
        }
      }
      if (list.some((s) => s.key.startsWith(`${e.key} `))) {
        pending.current = { key: e.key, at: now }; // first key of a sequence such as "g h"
        return;
      }
      const match = list.find((s) => s.key === e.key);
      if (match) {
        e.preventDefault();
        match.handler();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
