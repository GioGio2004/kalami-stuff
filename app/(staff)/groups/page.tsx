"use client";

import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { GroupsDashboard } from "@/components/groups/GroupsDashboard";
import { api } from "@/convex/_generated/api";

export default function GroupsPage() {
  const current = useCurrentUser();
  const router = useRouter();
  const ready = current.status === "ready";
  const groups = useQuery(api.groups.listMine, ready ? {} : "skip");
  const createGroup = useMutation(api.groups.create);

  // StaffGate only renders this page for signed-in staff.
  if (!ready) {
    return null;
  }
  return (
    <GroupsDashboard
      groups={groups}
      onCreate={async (args) => {
        const groupId = await createGroup(args);
        router.push(`/groups/${groupId}`);
      }}
    />
  );
}
