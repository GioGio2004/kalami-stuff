"use client";

import { UserButton } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import type { ReactNode } from "react";
import { AdminScopeProvider, filterOf, useAdminScope } from "@/components/admin/panel/AdminScope";
import { AdminShell } from "@/components/admin/panel/AdminShell";
import { useCurrentUser, type Me } from "@/components/CurrentUserProvider";
import { ButtonLink } from "@/components/ui/buttons";
import { StatusScreen } from "@/components/ui/StatusScreen";
import { api } from "@/convex/_generated/api";

export function isAdmin(me: Me): boolean {
  return me.memberships.some((m) => m.role === "super_admin" || m.role === "uni_admin");
}

/**
 * Everything under /admin: keeps non-admins out (the fence; the backend is the
 * lock), loads the administered universities and frames the pages in the shell.
 * Rendered inside StaffGate, so the user is signed in and staff here.
 */
export function AdminArea({ children }: { children: ReactNode }) {
  const current = useCurrentUser();
  const me = current.status === "ready" ? current.me : null;
  if (me === null || !isAdmin(me)) {
    return (
      <StatusScreen note="Admins only" title="Nothing to administer here">
        <p>This area is for university admins and the platform admin.</p>
        <ButtonLink href="/courses">Back to my courses</ButtonLink>
      </StatusScreen>
    );
  }
  return <AdminAreaInner me={me}>{children}</AdminAreaInner>;
}

function AdminAreaInner({ me, children }: { me: Me; children: ReactNode }) {
  const universities = useQuery(api.universities.listAdministered, {});
  return (
    <AdminScopeProvider isSuperAdmin={me.isSuperAdmin} universities={universities}>
      <Framed me={me}>{children}</Framed>
    </AdminScopeProvider>
  );
}

function Framed({ me, children }: { me: Me; children: ReactNode }) {
  const scope = useAdminScope();
  return (
    <AdminShell
      me={me}
      universities={scope.universities}
      picked={scope.picked}
      onPick={(picked) => scope.setFilter(filterOf(picked))}
      avatar={<UserButton />}
    >
      {children}
    </AdminShell>
  );
}
