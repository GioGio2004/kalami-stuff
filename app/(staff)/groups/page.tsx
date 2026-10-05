"use client";

import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { GroupsDashboard } from "@/components/groups/GroupsDashboard";
import { groupsMode } from "@/components/groups/types";
import { api } from "@/convex/_generated/api";

export default function GroupsPage() {
  const current = useCurrentUser();
  const router = useRouter();
  const ready = current.status === "ready";
  const mode = ready ? groupsMode(current.me.memberships) : null;
  const groups = useQuery(api.groups.listMine, ready ? {} : "skip");
  const createGroup = useMutation(api.groups.create);
  const joinGroup = useMutation(api.groups.joinAsLecturer);

  // Searching waits for a pause in typing.
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearched(query), 200);
    return () => clearTimeout(timer);
  }, [query]);
  const results = useQuery(api.groups.search, mode === "university" ? { query: searched } : "skip");

  // StaffGate only renders this page for signed-in staff.
  if (!ready || mode === null) {
    return null;
  }
  const isAdmin = current.me.memberships.some((m) => m.role === "uni_admin" || m.role === "super_admin");
  return (
    <GroupsDashboard
      groups={groups}
      mode={mode}
      isAdmin={isAdmin}
      search={
        mode === "university"
          ? {
              query,
              onQuery: setQuery,
              results,
              onJoin: async (groupId) => {
                await joinGroup({ groupId });
              },
            }
          : undefined
      }
      onCreate={
        mode === "independent"
          ? async (args) => {
              const groupId = await createGroup(args);
              router.push(`/groups/${groupId}`);
            }
          : undefined
      }
    />
  );
}
