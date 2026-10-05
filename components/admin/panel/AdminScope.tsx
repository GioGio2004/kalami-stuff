"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { ALL, NONE, type AdminUniversity, type UniversityFilter } from "@/components/admin/types";

/**
 * What the admin panel is looking at. The super admin picks a university, "no
 * university" or everything; a university admin always looks at one of their
 * own universities. Every page reads the filter from here and passes it to the
 * backend, which checks it again.
 */
export type AdminScopeValue = {
  isSuperAdmin: boolean;
  /** Universities the admin administers (every one for the super admin); undefined while loading. */
  universities: AdminUniversity[] | undefined;
  /** False until the filter is known: pages skip their queries until then. */
  ready: boolean;
  filter: UniversityFilter;
  setFilter: (filter: UniversityFilter) => void;
  /** The picker's value for the current filter ("all", "none" or a university id). */
  picked: string;
  /** How the current filter reads: "Every university", a university's name, "No university". */
  label: string;
};

export const AdminScopeContext = createContext<AdminScopeValue>({
  isSuperAdmin: false,
  universities: undefined,
  ready: false,
  filter: undefined,
  setFilter: () => undefined,
  picked: ALL,
  label: "",
});

// The choice is remembered for the tab (sessionStorage), read through a tiny
// store so it never has to be copied into React state.
const STORAGE_KEY = "kalami-admin-scope";
const listeners = new Set<() => void>();
let inMemory: string | null = null;

function readChoice(): string {
  if (inMemory !== null) return inMemory;
  try {
    return sessionStorage.getItem(STORAGE_KEY) ?? ALL;
  } catch {
    return ALL;
  }
}

function writeChoice(value: string) {
  inMemory = value;
  try {
    sessionStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Private windows may refuse; the choice just doesn't survive a reload.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The picker's value for a filter and back. */
export function pickedOf(filter: UniversityFilter): string {
  return filter === undefined ? ALL : filter;
}
export function filterOf(picked: string): UniversityFilter {
  return picked === ALL ? undefined : (picked as UniversityFilter);
}

export function labelOf(filter: UniversityFilter, universities: AdminUniversity[] | undefined): string {
  if (filter === undefined) return "Every university";
  if (filter === NONE) return "No university";
  return universities?.find((u) => u._id === filter)?.name.en ?? "University";
}

export function AdminScopeProvider({
  isSuperAdmin,
  universities,
  children,
}: {
  isSuperAdmin: boolean;
  universities: AdminUniversity[] | undefined;
  children: ReactNode;
}) {
  // null while rendering on the server: the choice lives in the browser.
  const chosen = useSyncExternalStore(subscribe, readChoice, () => null);
  const setFilter = useCallback((filter: UniversityFilter) => writeChoice(pickedOf(filter)), []);

  const value = useMemo<AdminScopeValue>(() => {
    const known = chosen !== null;
    let filter: UniversityFilter;
    let ready: boolean;
    if (isSuperAdmin) {
      // A university that no longer exists falls back to everything.
      const picked = chosen ?? ALL;
      const valid =
        picked === ALL || picked === NONE || universities === undefined || universities.some((u) => u._id === picked);
      filter = valid ? filterOf(picked) : undefined;
      ready = known;
    } else {
      // University admins always look at one of their own universities.
      const own = universities?.find((u) => u._id === chosen) ?? universities?.[0];
      filter = own?._id;
      ready = known && universities !== undefined;
    }
    return {
      isSuperAdmin,
      universities,
      ready,
      filter,
      setFilter,
      picked: pickedOf(filter),
      label: labelOf(filter, universities),
    };
  }, [chosen, isSuperAdmin, universities, setFilter]);

  return <AdminScopeContext.Provider value={value}>{children}</AdminScopeContext.Provider>;
}

export function useAdminScope(): AdminScopeValue {
  return useContext(AdminScopeContext);
}

/** The current minute, for queries that need the time without re-running every second. */
export function useMinute(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 60_000) * 60_000);
  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 60_000) * 60_000), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
