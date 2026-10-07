"use client";

import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Modal from "@cloudscape-design/components/modal";
import Table from "@cloudscape-design/components/table";

interface ShortcutHelp {
  keys: string[][]; // alternatives, each a key sequence: [["Delete"], ["Backspace"]], [["g", "h"]]
  action: string;
}

/** Every shortcut in the console, as listed in the help dialog. */
export const SHORTCUT_HELP: ShortcutHelp[] = [
  { keys: [["?"]], action: "Show keyboard shortcuts" },
  { keys: [["g", "h"]], action: "Go to Hosted zones" },
  { keys: [["Alt", "S"]], action: "Search the console" },
  { keys: [["/"]], action: "Focus the table filter" },
  { keys: [["c"]], action: "Create a hosted zone (hosted zones) or a record (hosted zone page)" },
  { keys: [["r"]], action: "Refresh the table" },
  { keys: [["e"]], action: "Edit the selected hosted zone or record (one selected)" },
  { keys: [["Delete"], ["Backspace"]], action: "Delete the selection (asks for confirmation)" },
  { keys: [["Esc"]], action: "Clear the selection" },
];

function Keys({ keys }: { keys: string[][] }) {
  return (
    <span className="r53-shortcut-keys">
      {keys.map((sequence, i) => (
        <span key={i}>
          {i > 0 && <span className="r53-shortcut-sep"> or </span>}
          {sequence.map((k, j) => (
            <span key={j}>
              {j > 0 && <span className="r53-shortcut-sep">{sequence[0] === "Alt" ? " + " : " then "}</span>}
              <kbd>{k}</kbd>
            </span>
          ))}
        </span>
      ))}
    </span>
  );
}

export function KeyboardShortcutsModal({ visible, onDismiss }: { visible: boolean; onDismiss: () => void }) {
  return (
    <Modal
      visible={visible}
      onDismiss={onDismiss}
      header="Keyboard shortcuts"
      footer={
        <Box float="right">
          <Button variant="primary" onClick={onDismiss}>
            Close
          </Button>
        </Box>
      }
    >
      <Table
        variant="embedded"
        items={SHORTCUT_HELP}
        trackBy="action"
        columnDefinitions={[
          { id: "key", header: "Key", cell: (s) => <Keys keys={s.keys} />, width: 190 },
          { id: "action", header: "Action", cell: (s) => s.action },
        ]}
        wrapLines
      />
      <Box margin={{ top: "s" }} color="text-body-secondary" fontSize="body-s">
        Shortcuts are ignored while you type in a field or while a dialog is open.
      </Box>
    </Modal>
  );
}
