"use client";

import { useMutation, useQuery } from "convex/react";
import { useAdminScope, useMinute } from "@/components/admin/panel/AdminScope";
import { UniversitiesView } from "@/components/admin/panel/UniversitiesView";
import { api } from "@/convex/_generated/api";

export default function UniversitiesPage() {
  const scope = useAdminScope();
  const now = useMinute();
  const rows = useQuery(api.platform.universities, scope.ready ? { now } : "skip");
  const create = useMutation(api.universities.create);
  const update = useMutation(api.platform.updateUniversity);
  return (
    <UniversitiesView
      rows={rows}
      isSuperAdmin={scope.isSuperAdmin}
      onCreate={create}
      onUpdate={async (universityId, patch) => {
        await update({ universityId, ...patch });
      }}
    />
  );
}
