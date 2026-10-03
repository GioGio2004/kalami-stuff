"use client";

import { useEffect, useState } from "react";
import { buttonClass } from "@/components/ui/buttons";
import { Check, Copy } from "@/components/ui/icons";

/** Copies `value` and says so for a moment. */
export function CopyButton({
  value,
  label = "Copy",
  variant = "outline",
  size = "sm",
  className = "",
}: {
  value: string;
  label?: string;
  variant?: "outline" | "ink" | "lime" | "ghost";
  size?: "sm" | "md";
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      className={`${buttonClass(variant, size)} ${className}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
        } catch {
          // Clipboard access can be refused (insecure context); the text stays selectable.
        }
      }}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      {copied ? "Copied" : label}
    </button>
  );
}
