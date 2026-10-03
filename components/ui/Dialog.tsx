"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Cross } from "@/components/ui/icons";

/**
 * A modal on the native <dialog> element: focus trapping, Escape and the
 * backdrop come for free. Styled as a paper card floating over dimmed ink.
 */
export function Dialog({
  open,
  onClose,
  label,
  size = "md",
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Accessible name; the visible title lives in the children. */
  label: string;
  size?: "md" | "lg";
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // Where the current click started. A text selection dragged out of a field and
  // released over the backdrop also fires `click` on the dialog, and must not close it.
  const pressedOnBackdrop = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const width = size === "lg" ? "max-w-4xl" : "max-w-2xl";

  return (
    <dialog
      ref={ref}
      aria-label={label}
      onClose={onClose}
      onPointerDown={(event) => {
        // Clicks on the backdrop land on the dialog element itself.
        pressedOnBackdrop.current = event.target === ref.current;
      }}
      onClick={(event) => {
        if (pressedOnBackdrop.current && event.target === ref.current) {
          onClose();
        }
        pressedOnBackdrop.current = false;
      }}
      className={`m-auto w-[calc(100vw-1.5rem)] ${width} rounded-[2.25rem] bg-paper p-0 text-ink shadow-[0_40px_80px_-30px_rgba(20,20,20,0.5)] backdrop:bg-ink/45 backdrop:backdrop-blur-[2px]`}
    >
      {open && (
        <div className="relative">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-4 top-4 z-10 grid size-10 place-items-center rounded-full bg-panel text-graphite transition hover:bg-panel-strong hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            <Cross className="size-4" />
          </button>
          {children}
        </div>
      )}
    </dialog>
  );
}
