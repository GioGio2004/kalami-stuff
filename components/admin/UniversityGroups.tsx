"use client";

import { useMutation, useQuery } from "convex/react";
import { GroupsBoard } from "@/components/admin/GroupsBoard";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

/** One university's groups on the admin page. */
export function UniversityGroups({ universityId }: { universityId: Id<"universities"> }) {
  const groups = useQuery(api.groups.forUniversity, { universityId });
  const createGroup = useMutation(api.groups.create);
  return <GroupsBoard groups={groups} onCreate={(args) => createGroup({ universityId, ...args })} />;
}
