"use client";

import { useAdminScope } from "@/components/admin/panel/AdminScope";
import { PanelHeader } from "@/components/admin/panel/ui";
import { SuperAdminPeople } from "@/components/admin/SuperAdminPeople";
import { ButtonLink } from "@/components/ui/buttons";

export default function PeoplePage() {
  const scope = useAdminScope();
  return (
    <>
      <PanelHeader
        note="People"
        title="Find a person"
        description="Any account, by the start of its email: students, staff and people who signed up but have no role yet. Change or remove a lecturer's or university admin's role here."
      />
      {scope.isSuperAdmin ? (
        <SuperAdminPeople universities={scope.universities} />
      ) : (
        <div className="rounded-[2rem] bg-card p-6 sm:p-7">
          <p className="text-graphite">Only the platform admin searches every account. Your university&apos;s people are under Students and Lecturers.</p>
          <ButtonLink href="/admin/lecturers" className="mt-4" variant="outline">
            Lecturers
          </ButtonLink>
        </div>
      )}
    </>
  );
}
