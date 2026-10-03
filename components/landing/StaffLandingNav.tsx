import { Show } from "@clerk/nextjs";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { Enter } from "@/components/motion/Reveal";
import { ArrowLink } from "@/components/ui/buttons";

const links = [
  { href: "#tools", label: "Tools" },
  { href: "#live", label: "Live exams" },
  { href: "#levels", label: "Integrity levels" },
  { href: "#universities", label: "Universities" },
];

export function StaffLandingNav() {
  return (
    <div className="sticky top-3 z-50 px-3 sm:top-4 sm:px-6">
      <Enter kind="drop" className="mx-auto max-w-6xl">
      <header className="flex items-center gap-3 rounded-full border border-line bg-paper/80 py-2 pl-4 pr-2 shadow-[0_10px_40px_-18px_rgba(20,20,20,0.35)] backdrop-blur-md sm:pl-5">
        <Link href="/" aria-label="Kalami AntiCheat home" className="flex shrink-0 items-center gap-2.5">
          <Logo />
          <span className="hidden rounded-full bg-ink px-2.5 py-1 text-xs font-semibold text-highlighter sm:inline">
            AntiCheat
          </span>
        </Link>
        <nav className="ml-auto hidden items-center gap-1 lg:flex">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-full px-3.5 py-2 text-[15px] text-graphite transition-colors hover:bg-panel hover:text-ink"
            >
              {link.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1.5 lg:ml-3">
          <Show when="signed-out">
            <a
              href="mailto:hello@kalami.space"
              className="hidden rounded-full px-4 py-2.5 text-[15px] font-medium transition-colors hover:bg-panel sm:block"
            >
              Request a pilot
            </a>
            <ArrowLink href="/sign-in">Sign in</ArrowLink>
          </Show>
          <Show when="signed-in">
            <ArrowLink href="/courses">Open the studio</ArrowLink>
          </Show>
        </div>
      </header>
      </Enter>
    </div>
  );
}
