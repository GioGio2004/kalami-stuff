"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Logo } from "@/components/Logo";

type NavLink = { href: string; label: string };

/** The floating pill header used across the app (the landing page has its own). */
export function PillHeader({
  homeHref,
  tag,
  links = [],
  actions,
}: {
  homeHref: string;
  tag?: string;
  links?: NavLink[];
  actions?: ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div className="sticky top-3 z-40 px-3 sm:top-4 sm:px-6">
      <motion.header
        initial={{ y: -70, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 140, damping: 18 }}
        className="mx-auto flex max-w-6xl items-center gap-2 rounded-full border border-line bg-paper/80 py-2 pl-4 pr-2 shadow-[0_10px_40px_-18px_rgba(20,20,20,0.35)] backdrop-blur-md sm:gap-3 sm:pl-5">
        <Link href={homeHref} className="flex shrink-0 items-center gap-2.5" aria-label="Home">
          <Logo />
          {tag && (
            <span className="hidden rounded-full bg-ink px-2.5 py-1 text-xs font-semibold text-highlighter sm:inline">
              {tag}
            </span>
          )}
        </Link>
        {links.length > 0 && (
          <nav className="ml-1 flex min-w-0 items-center gap-1 overflow-x-auto sm:ml-4">
            {links.map((link) => {
              const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={`relative shrink-0 rounded-full px-3.5 py-2 text-[15px] transition-colors ${
                    active ? "font-medium text-ink" : "text-graphite hover:bg-panel hover:text-ink"
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="nav-active"
                      className="absolute inset-0 rounded-full bg-panel"
                      transition={{ type: "spring", stiffness: 380, damping: 30 }}
                    />
                  )}
                  <span className="relative">{link.label}</span>
                </Link>
              );
            })}
          </nav>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>
      </motion.header>
    </div>
  );
}
