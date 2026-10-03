"use client";

import { useMutation, useQuery } from "convex/react";
import { InvitesBoard } from "@/components/admin/InvitesBoard";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export function UniversityInvites({
  universityId,
  canInviteAdmins,
}: {
  universityId: Id<"universities">;
  canInviteAdmins: boolean;
}) {
  const invites = useQuery(api.invites.listForUniversity, { universityId });
  const createInvite = useMutation(api.invites.create);
  const revokeInvite = useMutation(api.invites.revoke);
  return (
    <InvitesBoard
      invites={invites}
      canInviteAdmins={canInviteAdmins}
      onCreate={(args) => createInvite({ universityId, ...args })}
      onRevoke={(inviteId) => revokeInvite({ inviteId })}
    />
  );
}
