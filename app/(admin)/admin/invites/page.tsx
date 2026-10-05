"use client";

import { useAdminScope } from "@/components/admin/panel/AdminScope";
import { PanelHeader } from "@/components/admin/panel/ui";
import { SuperAdminInvites } from "@/components/admin/SuperAdminInvites";
import { UniversityInvites } from "@/components/admin/UniversityInvites";
import { WritingDots } from "@/components/ui/StatusScreen";

export default function InvitesPage() {
  const scope = useAdminScope();
  return (
    <>
      <PanelHeader
        note="People"
        title="Invites"
        description={
          scope.isSuperAdmin
            ? "Invite lecturers and university admins to any university, or independent teachers, and keep track of every invitation in one list."
            : "Invite the lecturers of your university. Kalami emails them a personal link; the link works for their email only, for 14 days."
        }
      />
      {scope.isSuperAdmin ? (
        <SuperAdminInvites universities={scope.universities} />
      ) : scope.universities === undefined ? (
        <div className="flex justify-center py-12">
          <WritingDots label="Loading" />
        </div>
      ) : (
        scope.universities.map((university) => (
          <section key={university._id} className="space-y-3">
            {scope.universities!.length > 1 && <h2 className="px-1 text-xl font-medium tracking-tight">{university.name.en}</h2>}
            <UniversityInvites universityId={university._id} canInviteAdmins={false} />
          </section>
        ))
      )}
    </>
  );
}
