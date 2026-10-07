"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { FlashbarProps } from "@cloudscape-design/components/flashbar";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import { api } from "@/lib/api";
import type { ChangeInfo, ChangeStatus } from "@/types";

type NotifyType = "success" | "error" | "info" | "warning";

export interface Notification {
  type: NotifyType;
  header?: string;
  content: React.ReactNode;
  /** Keep the message until it is dismissed or updated (e.g. while a change is PENDING). */
  persistent?: boolean;
}

interface NotificationsContextValue {
  items: FlashbarProps.MessageDefinition[];
  /** Show a flash message and return its id. */
  notify: (n: Notification) => string;
  /** Change a message in place; dropping `persistent` starts the auto-dismiss timer. */
  update: (id: string, n: Partial<Notification>) => void;
  /** Success message for a record change that tracks it from PENDING to INSYNC. */
  notifyChange: (message: React.ReactNode, change: ChangeInfo) => string;
  clearAll: () => void;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);
let counter = 0;
const AUTO_DISMISS_MS = 8000;
const POLL_MS = 2000;
const POLL_LIMIT_MS = 2 * 60 * 1000;

function ChangeStatusContent({ message, status }: { message: React.ReactNode; status: ChangeStatus }) {
  return (
    <>
      <div>{message}</div>
      <div className="r53-change-status">
        Status:{" "}
        <StatusIndicator type={status === "INSYNC" ? "success" : "pending"}>
          {status}
        </StatusIndicator>
      </div>
    </>
  );
}

/** Console-style Flashbar notifications shown at the top of the content area. */
export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<FlashbarProps.MessageDefinition[]>([]);
  const live = useRef(new Set<string>()); // ids currently on screen
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const clearTimer = useCallback((id: string) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
  }, []);

  const dismiss = useCallback(
    (id: string) => {
      live.current.delete(id);
      clearTimer(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
    },
    [clearTimer],
  );

  const scheduleDismiss = useCallback(
    (id: string) => {
      clearTimer(id);
      timers.current.set(id, setTimeout(() => dismiss(id), AUTO_DISMISS_MS));
    },
    [clearTimer, dismiss],
  );

  const notify = useCallback(
    (n: Notification) => {
      const id = `flash-${++counter}`;
      live.current.add(id);
      setItems((prev) => {
        // A new success replaces older successes so messages never pile up over the page.
        const kept = prev.filter((i) => n.type !== "success" || i.type !== "success").slice(0, 2);
        prev.filter((i) => !kept.includes(i)).forEach((i) => {
          live.current.delete(i.id!);
          clearTimer(i.id!);
        });
        return [
          {
            id,
            type: n.type,
            header: n.header,
            content: n.content,
            dismissible: true,
            dismissLabel: "Dismiss message",
            onDismiss: () => dismiss(id),
          },
          ...kept,
        ];
      });
      if (!n.persistent && (n.type === "success" || n.type === "info")) scheduleDismiss(id);
      return id;
    },
    [clearTimer, dismiss, scheduleDismiss],
  );

  const update = useCallback(
    (id: string, n: Partial<Notification>) => {
      if (!live.current.has(id)) return;
      setItems((prev) =>
        prev.map((i) =>
          i.id === id
            ? { ...i, ...(n.type && { type: n.type }), ...(n.header !== undefined && { header: n.header }), ...(n.content !== undefined && { content: n.content }) }
            : i,
        ),
      );
      if (n.persistent === false) scheduleDismiss(id);
    },
    [scheduleDismiss],
  );

  const notifyChange = useCallback(
    (message: React.ReactNode, change: ChangeInfo) => {
      const pending = change.status === "PENDING";
      const id = notify({
        type: "success",
        content: <ChangeStatusContent message={message} status={change.status} />,
        persistent: pending,
      });
      if (!pending) return id;

      // Poll GetChange until INSYNC; stop when the message goes away or after two minutes.
      const started = Date.now();
      const poll = async () => {
        if (!live.current.has(id)) return;
        if (Date.now() - started > POLL_LIMIT_MS) {
          update(id, { persistent: false });
          return;
        }
        try {
          const latest = await api.changes.get(change.id);
          if (latest.status === "INSYNC") {
            update(id, { content: <ChangeStatusContent message={message} status="INSYNC" />, persistent: false });
            return;
          }
        } catch {
          /* transient error: keep polling */
        }
        if (live.current.has(id)) timers.current.set(id, setTimeout(poll, POLL_MS));
      };
      timers.current.set(id, setTimeout(poll, POLL_MS));
      return id;
    },
    [notify, update],
  );

  const clearAll = useCallback(() => {
    live.current.clear();
    timers.current.forEach((t) => clearTimeout(t));
    timers.current.clear();
    setItems([]);
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((t) => clearTimeout(t));
  }, []);

  const value = useMemo(
    () => ({ items, notify, update, notifyChange, clearAll }),
    [items, notify, update, notifyChange, clearAll],
  );
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications must be used inside NotificationsProvider");
  return ctx;
}
