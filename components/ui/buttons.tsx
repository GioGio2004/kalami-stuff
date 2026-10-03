import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { ArrowUpRight } from "@/components/ui/icons";

type Variant = "ink" | "lime" | "outline" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  ink: "bg-ink text-paper hover:bg-ink/85",
  lime: "bg-highlighter text-ink hover:brightness-95",
  outline: "border border-ink/15 text-ink hover:bg-panel",
  ghost: "text-ink hover:bg-panel",
  danger: "bg-red-pen/10 text-red-pen hover:bg-red-pen/15",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-4 text-sm",
  md: "h-11 px-5 text-[15px]",
  lg: "h-13 px-7 text-base",
};

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

export function buttonClass(variant: Variant = "ink", size: Size = "md") {
  return `inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 ${focusRing} ${variants[variant]} ${sizes[size]}`;
}

type Styling = { variant?: Variant; size?: Size };

export function Button({
  variant,
  size,
  className = "",
  type = "button",
  ...props
}: ComponentProps<"button"> & Styling) {
  return <button type={type} className={`${buttonClass(variant, size)} ${className}`} {...props} />;
}

export function ButtonLink({
  variant,
  size,
  className = "",
  ...props
}: ComponentProps<typeof Link> & Styling) {
  return <Link className={`${buttonClass(variant, size)} ${className}`} {...props} />;
}

type ArrowTone = "ink" | "lime";

const arrowTones: Record<ArrowTone, { pill: string; chip: string }> = {
  ink: { pill: "bg-ink text-paper", chip: "bg-highlighter text-ink" },
  lime: { pill: "bg-highlighter text-ink", chip: "bg-ink text-highlighter" },
};

function arrowClass(tone: ArrowTone) {
  return `group inline-flex shrink-0 items-center gap-3 whitespace-nowrap rounded-full py-1.5 pl-5 pr-1.5 text-[15px] font-medium transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 ${focusRing} ${arrowTones[tone].pill}`;
}

function ArrowChip({ tone }: { tone: ArrowTone }) {
  return (
    <span
      className={`grid size-8 place-items-center rounded-full transition-transform duration-300 group-hover:rotate-45 ${arrowTones[tone].chip}`}
    >
      <ArrowUpRight className="size-4" />
    </span>
  );
}

/** The signature call to action: a pill with a round arrow chip that turns on hover. */
export function ArrowLink({
  tone = "ink",
  className = "",
  children,
  ...props
}: ComponentProps<typeof Link> & { tone?: ArrowTone; children: ReactNode }) {
  return (
    <Link className={`${arrowClass(tone)} ${className}`} {...props}>
      {children}
      <ArrowChip tone={tone} />
    </Link>
  );
}

export function ArrowButton({
  tone = "ink",
  className = "",
  type = "button",
  children,
  ...props
}: ComponentProps<"button"> & { tone?: ArrowTone; children: ReactNode }) {
  return (
    <button type={type} className={`${arrowClass(tone)} ${className}`} {...props}>
      {children}
      <ArrowChip tone={tone} />
    </button>
  );
}
