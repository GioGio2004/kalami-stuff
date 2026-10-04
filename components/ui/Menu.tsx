"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export type MenuItem = {
  label: string;
  /** A second, quieter line under the label. */
  description?: string;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
};

const ITEM = '[role="menuitem"]:not([disabled])';

/**
 * A button that opens a small list of actions. Keyboard: Enter, Space or
 * Arrow Down opens it on the first item; arrows, Home and End move; Escape
 * closes it and returns to the button; Tab closes it and moves on.
 */
export function Menu({
  label,
  items,
  children,
  align = "end",
  buttonClassName = "",
  menuClassName = "",
}: {
  /** Accessible name of the button, e.g. "More actions for Week 2". */
  label: string;
  items: MenuItem[];
  /** What the button shows. */
  children: ReactNode;
  align?: "start" | "end";
  buttonClassName?: string;
  menuClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  // Opens upwards when there's no room below (a menu near the bottom of the screen).
  const [up, setUp] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }
    menuRef.current?.querySelector<HTMLButtonElement>(ITEM)?.focus();
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function openMenu() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      const needed = items.length * (items.some((item) => item.description) ? 60 : 44) + 24;
      const below = window.innerHeight - rect.bottom;
      setUp(below < needed && rect.top > below);
    }
    setOpen(true);
  }

  function close(refocus: boolean) {
    setOpen(false);
    if (refocus) {
      buttonRef.current?.focus();
    }
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const all = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>(ITEM) ?? []);
    const index = all.indexOf(document.activeElement as HTMLButtonElement);
    const focus = (i: number) => all[(i + all.length) % all.length]?.focus();
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focus(index + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focus(index - 1);
        break;
      case "Home":
        event.preventDefault();
        focus(0);
        break;
      case "End":
        event.preventDefault();
        focus(all.length - 1);
        break;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        close(true);
        break;
      case "Tab":
        close(false);
        break;
    }
  }

  return (
    <div className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            openMenu();
          }
        }}
        className={`focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${buttonClassName}`}
      >
        {children}
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className={`absolute z-30 w-max min-w-52 max-w-[min(22rem,calc(100vw-2rem))] rounded-2xl bg-card p-1.5 shadow-xl shadow-ink/15 ring-1 ring-line ${
            up ? "bottom-full mb-2" : "top-full mt-2"
          } ${align === "end" ? "right-0" : "left-0"} ${menuClassName}`}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                close(true);
                item.onSelect();
              }}
              className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left text-sm outline-none transition hover:bg-panel focus-visible:bg-panel focus-visible:ring-2 focus-visible:ring-ink disabled:opacity-40 ${
                item.danger ? "text-red-pen" : "text-ink"
              }`}
            >
              {item.icon && (
                <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-panel text-ink">
                  {item.icon}
                </span>
              )}
              <span className="min-w-0 self-center">
                <span className="block font-medium">{item.label}</span>
                {item.description && (
                  <span className="mt-0.5 block text-xs leading-snug text-graphite">{item.description}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
