import type { ComponentProps, ReactNode } from "react";
import { Check, ChevronDown, Cross } from "@/components/ui/icons";

export const inputClass =
  "block w-full rounded-2xl border border-line bg-card px-4 py-3 text-[15px] text-ink outline-none transition placeholder:text-graphite/55 hover:border-ink/25 focus:border-ink focus:ring-4 focus:ring-highlighter/60 disabled:cursor-not-allowed disabled:bg-panel disabled:text-graphite";

export function Field({
  label,
  htmlFor,
  hint,
  optional = false,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={htmlFor} className="flex items-baseline justify-between gap-3 text-sm font-medium">
        {label}
        {optional && <span className="text-xs font-normal text-graphite">optional</span>}
      </label>
      {children}
      {hint && <p className="text-xs leading-relaxed text-graphite">{hint}</p>}
    </div>
  );
}

export function TextInput({ className = "", ...props }: ComponentProps<"input">) {
  return <input className={`${inputClass} ${className}`} {...props} />;
}

export function TextArea({ className = "", rows = 3, ...props }: ComponentProps<"textarea">) {
  return <textarea rows={rows} className={`${inputClass} resize-y leading-relaxed ${className}`} {...props} />;
}

export function SelectInput({ className = "", children, ...props }: ComponentProps<"select">) {
  return (
    <div className="relative">
      <select className={`${inputClass} appearance-none pr-11 ${className}`} {...props}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-4 top-1/2 size-4 -translate-y-1/2 text-graphite" />
    </div>
  );
}

/** Pill tabs where one option is active (the dark pill), used as a radio group. */
export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-full bg-panel p-1">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={`min-w-11 rounded-full px-4 py-2 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink ${
              active ? "bg-ink text-paper shadow-sm" : "text-graphite hover:text-ink"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** A checkbox drawn as a lime tick box inside a clickable card. */
export function CheckCard({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3.5 rounded-2xl border p-4 transition ${
        checked ? "border-ink bg-highlighter/25" : "border-line bg-card hover:border-ink/25"
      }`}
    >
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span
        aria-hidden
        className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-lg border-2 transition peer-focus-visible:ring-4 peer-focus-visible:ring-highlighter/70 ${
          checked ? "border-ink bg-highlighter text-ink" : "border-ink/25 bg-card text-transparent"
        }`}
      >
        <Check className="size-4" />
      </span>
      <span className="text-[15px] font-medium leading-snug">{children}</span>
    </label>
  );
}

export function FormError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="flex items-start gap-2.5 rounded-2xl bg-red-pen/10 px-4 py-3 text-sm text-red-pen">
      <Cross className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
