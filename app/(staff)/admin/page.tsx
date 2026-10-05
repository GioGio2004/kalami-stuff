"use client";

import { useMutation, useQuery } from "convex/react";
import { AdminView } from "@/components/admin/AdminView";
import { SuperAdminInvites } from "@/components/admin/SuperAdminInvites";
import { UniversityGroups } from "@/components/admin/UniversityGroups";
import { UniversityInvites } from "@/components/admin/UniversityInvites";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { ButtonLink } from "@/components/ui/buttons";
import { api } from "@/convex/_generated/api";

export default function AdminPage() {
  const current = useCurrentUser();
  const me = current.status === "ready" ? current.me : null;
  const isAdmin = !!me?.memberships.some((m) => m.role === "super_admin" || m.role === "uni_admin");
  const universities = useQuery(api.universities.listAdministered, isAdmin ? {} : "skip");
  const createUniversity = useMutation(api.universities.create);

  if (!me || !isAdmin) {
    return (
      <div className="rounded-[2.75rem] bg-panel px-6 py-14 sm:px-12">
        <p className="-rotate-2 font-hand text-[1.8rem] leading-none text-graphite">Admins only</p>
        <h1 className="mt-3 text-4xl font-medium tracking-[-0.04em] sm:text-5xl">Nothing to administer here</h1>
        <p className="mt-4 max-w-md text-lg text-graphite">
          This page is for university admins and the platform admin.
        </p>
        <ButtonLink href="/courses" className="mt-8">
          Back to my courses
        </ButtonLink>
      </div>
    );
  }

  return (
    <AdminView
      isSuperAdmin={me.isSuperAdmin}
      universities={universities}
      onCreateUniversity={createUniversity}
      // The super admin invites everyone from one place, picking the university per invite;
      // a university admin invites inside their university.
      invites={me.isSuperAdmin ? <SuperAdminInvites universities={universities} /> : undefined}
      renderInvites={
        me.isSuperAdmin
          ? undefined
          : (university) => <UniversityInvites universityId={university._id} canInviteAdmins={false} />
      }
      renderGroups={(university) => <UniversityGroups universityId={university._id} />}
    />
  );
}
