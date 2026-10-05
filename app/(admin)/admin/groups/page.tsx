"use client";

import { useMutation, useQuery } from "convex/react";
import { useAdminScope } from "@/components/admin/panel/AdminScope";
import { GroupsView } from "@/components/admin/panel/GroupsView";
import { api } from "@/convex/_generated/api";

export default function GroupsPage() {
  const scope = useAdminScope();
  const rows = useQuery(api.platform.groups, scope.ready ? { university: scope.filter } : "skip");
  const create = useMutation(api.groups.create);
  const update = useMutation(api.groups.update);
  const setLink = useMutation(api.groups.setInviteLink);
  return (
    <GroupsView
      rows={rows}
      universities={scope.universities}
      filter={scope.filter}
      isSuperAdmin={scope.isSuperAdmin}
      scopeLabel={scope.label}
      actions={{
        onCreate: (args) => create(args),
        onArchive: async (groupId, archived) => {
          await update({ groupId, archived });
        },
        onSetLink: async (groupId, enabled) => {
          await setLink({ groupId, enabled });
        },
      }}
    />
  );
}
