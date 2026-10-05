"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { useAdminScope, useMinute } from "@/components/admin/panel/AdminScope";
import { StaffDetailDialog } from "@/components/admin/panel/StaffDetail";
import { StaffView, type StaffRoleFilter } from "@/components/admin/panel/StaffView";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useDebounced } from "@/lib/useDebounced";

export default function LecturersPage() {
  const scope = useAdminScope();
  const now = useMinute();
  const [roleFilter, setRoleFilter] = useState<StaffRoleFilter>("all");
  const [query, setQuery] = useState("");
  const searched = useDebounced(query);
  const searching = searched.trim().length >= 2;
  const rows = useQuery(
    api.platform.staff,
    scope.ready && !searching ? { university: scope.filter, role: roleFilter === "all" ? undefined : roleFilter } : "skip",
  );
  const found = useQuery(api.platform.findStaff, scope.ready && searching ? { university: scope.filter, query: searched } : "skip");
  const [openId, setOpenId] = useState<Id<"users"> | null>(null);
  const detail = useQuery(api.platform.staffMember, openId === null ? "skip" : { userId: openId });
  const changeRole = useMutation(api.people.changeStaffRole);
  const removeRole = useMutation(api.people.removeStaffRole);
  const addRole = useMutation(api.platform.addStaffRole);

  return (
    <>
      <StaffView
        rows={searching ? (searched === query ? found : undefined) : rows}
        roleFilter={roleFilter}
        onRoleFilter={setRoleFilter}
        query={query}
        onQuery={setQuery}
        searching={searching}
        isSuperAdmin={scope.isSuperAdmin}
        scopeLabel={scope.label}
        now={now}
        onOpen={setOpenId}
      />
      <StaffDetailDialog
        detail={detail}
        open={openId !== null}
        onClose={() => setOpenId(null)}
        universities={scope.universities}
        isSuperAdmin={scope.isSuperAdmin}
        now={now}
        actions={{
          onChangeRole: async (membershipId, role, universityId) => {
            await changeRole({ membershipId, role, universityId });
          },
          onRemoveRole: async (membershipId) => {
            await removeRole({ membershipId });
          },
          onAddRole: async (role, universityId) => {
            if (openId === null) return;
            await addRole({ userId: openId, role, universityId });
          },
        }}
      />
    </>
  );
}
