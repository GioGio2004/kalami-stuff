"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps, ComponentType, ReactNode } from "react";
import { ALL, NONE, type AdminUniversity } from "@/components/admin/types";
import type { Me } from "@/components/CurrentUserProvider";
import { KalamiMark, Logo } from "@/components/Logo";
import { ButtonLink } from "@/components/ui/buttons";
import { SelectInput } from "@/components/ui/form";
import { Building, Clock, Grid, Mail, Notebook, Pen, Search, Shield, Users } from "@/components/ui/icons";

type IconProps = ComponentProps<"svg">;
type NavItem = { href: string; label: string; icon: ComponentType<IconProps>; superOnly?: boolean; exact?: boolean };

/** The sidebar, grouped. University admins don't see the super admin's items. */
export const ADMIN_SECTIONS: { title: string; items: NavItem[] }[] = [
  { title: "Overview", items: [{ href: "/admin", label: "Overview", icon: Grid, exact: true }] },
  {
    title: "People",
    items: [
      { href: "/admin/students", label: "Students", icon: Users },
      { href: "/admin/lecturers", label: "Lecturers", icon: Pen },
      { href: "/admin/people", label: "Find a person", icon: Search, superOnly: true },
      { href: "/admin/invites", label: "Invites", icon: Mail },
    ],
  },
  {
    title: "Teaching",
    items: [
      { href: "/admin/universities", label: "Universities", icon: Building },
      { href: "/admin/courses", label: "Courses", icon: Notebook },
      { href: "/admin/groups", label: "Groups", icon: Users },
    ],
  },
  {
    title: "Platform",
    items: [
      { href: "/admin/activity", label: "Activity", icon: Clock, superOnly: true },
      { href: "/admin/system", label: "System", icon: Shield, superOnly: true },
    ],
  },
];

function isActive(item: NavItem, pathname: string): boolean {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** The university picker: the super admin chooses, a university admin with one university just sees it. */
function ScopePicker({
  id,
  isSuperAdmin,
  universities,
  picked,
  onPick,
  compact = false,
}: {
  id: string;
  isSuperAdmin: boolean;
  universities: AdminUniversity[] | undefined;
  picked: string;
  onPick: (picked: string) => void;
  compact?: boolean;
}) {
  if (!isSuperAdmin && (universities?.length ?? 0) <= 1) {
    const only = universities?.[0];
    return (
      <p className={`truncate rounded-full bg-card px-3.5 py-2 text-sm ${compact ? "" : "font-medium"}`} title={only?.name.en}>
        {only?.name.en ?? "…"}
      </p>
    );
  }
  return (
    <div>
      <label htmlFor={id} className="sr-only">
        Which university to show
      </label>
      <SelectInput id={id} value={picked} onChange={(e) => onPick(e.target.value)} className={compact ? "py-2 text-sm" : ""}>
        {isSuperAdmin && <option value={ALL}>Every university</option>}
        {(universities ?? []).map((u) => (
          <option key={u._id} value={u._id}>
            {u.name.en}
            {u.status === "archived" ? " (archived)" : ""}
          </option>
        ))}
        {isSuperAdmin && <option value={NONE}>No university</option>}
      </SelectInput>
    </div>
  );
}

/**
 * The admin area's frame: a sidebar on wide screens, a top bar with section
 * chips on phones. Separate from the staff app's pill header on purpose: the
 * panel is its own place, with its own navigation.
 */
export function AdminShell({
  me,
  universities,
  picked,
  onPick,
  avatar,
  pathname: forcedPathname,
  children,
}: {
  me: Me;
  universities: AdminUniversity[] | undefined;
  /** The picker's value: "all", "none" or a university id. */
  picked: string;
  onPick: (picked: string) => void;
  /** The account button; the dev gallery passes a stand-in. */
  avatar: ReactNode;
  /** The dev gallery sets the path; the app reads it from the router. */
  pathname?: string;
  children: ReactNode;
}) {
  const routerPathname = usePathname();
  const pathname = forcedPathname ?? routerPathname;
  const isSuperAdmin = me.isSuperAdmin;
  const sections = ADMIN_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => isSuperAdmin || !item.superOnly),
  })).filter((section) => section.items.length > 0);
  const name = [me.firstName, me.lastName].filter(Boolean).join(" ") || me.email;

  return (
    <div className="mx-auto flex w-full max-w-[100rem] flex-1 flex-col gap-3 px-3 pb-10 pt-3 sm:px-5 lg:flex-row lg:items-start lg:gap-6 lg:pt-4">
      {/* Phones and tablets: a bar with the picker, then the sections as chips. */}
      <div className="sticky top-3 z-40 lg:hidden">
        <div className="flex items-center gap-2.5 rounded-full border border-line bg-paper/85 py-2 pl-3 pr-2 shadow-[0_10px_40px_-18px_rgba(20,20,20,0.35)] backdrop-blur-md">
          <Link href="/admin" className="flex shrink-0 items-center gap-2" aria-label="Admin overview">
            <KalamiMark className="size-9" />
            <span className="rounded-full bg-ink px-2.5 py-1 text-xs font-semibold text-highlighter">Admin</span>
          </Link>
          <div className="min-w-0 flex-1">
            <ScopePicker id="admin-scope-mobile" isSuperAdmin={isSuperAdmin} universities={universities} picked={picked} onPick={onPick} compact />
          </div>
          <div className="shrink-0">{avatar}</div>
        </div>
        <nav aria-label="Admin sections" className="no-scrollbar -mx-3 mt-2 flex gap-1.5 overflow-x-auto px-3 pb-1">
          {sections.flatMap((section) =>
            section.items.map((item) => {
              const active = isActive(item, pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-sm transition ${
                    active ? "bg-ink text-paper" : "bg-panel text-graphite hover:text-ink"
                  }`}
                >
                  <item.icon className="size-4" />
                  {item.label}
                </Link>
              );
            }),
          )}
        </nav>
      </div>

      {/* Wide screens: the sidebar. */}
      <aside className="hidden lg:sticky lg:top-4 lg:flex lg:h-[calc(100vh-2rem)] lg:w-64 lg:shrink-0 lg:flex-col lg:rounded-[2rem] lg:bg-panel lg:p-4">
        <Link href="/admin" className="flex items-center gap-2.5 px-1" aria-label="Admin overview">
          <Logo />
          <span className="ml-auto rounded-full bg-ink px-2.5 py-1 text-xs font-semibold text-highlighter">Admin</span>
        </Link>
        <div className="mt-5">
          <p className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-graphite">Showing</p>
          <ScopePicker id="admin-scope" isSuperAdmin={isSuperAdmin} universities={universities} picked={picked} onPick={onPick} />
        </div>
        <nav aria-label="Admin sections" className="no-scrollbar mt-5 flex-1 space-y-5 overflow-y-auto">
          {sections.map((section) => (
            <div key={section.title}>
              <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-graphite">{section.title}</p>
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const active = isActive(item, pathname);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={`flex items-center gap-2.5 rounded-full px-3 py-2 text-[15px] transition ${
                          active ? "bg-ink font-medium text-paper" : "text-graphite hover:bg-card hover:text-ink"
                        }`}
                      >
                        <item.icon className={`size-4 shrink-0 ${active ? "text-highlighter" : ""}`} />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <footer className="mt-4 border-t border-line pt-4">
          <div className="flex items-center gap-3 px-1">
            <div className="shrink-0">{avatar}</div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{name}</p>
              <p className="truncate text-xs text-graphite">{isSuperAdmin ? "Platform admin" : "University admin"}</p>
            </div>
          </div>
          <ButtonLink href="/courses" variant="outline" size="sm" className="mt-3 w-full">
            Back to the studio
          </ButtonLink>
        </footer>
      </aside>

      <main className="min-w-0 flex-1 space-y-4">{children}</main>
    </div>
  );
}
