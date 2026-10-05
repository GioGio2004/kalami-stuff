"use client";

import { useMutation, useQuery } from "convex/react";
import { InvitesBoard } from "@/components/admin/InvitesBoard";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

/** Invites for one university, or (no universityId; super admin only) for independent teachers. */
export function UniversityInvites({
  universityId,
  canInviteAdmins,
}: {
  universityId?: Id<"universities">;
  canInviteAdmins: boolean;
}) {
  const invites = useQuery(api.invites.listForUniversity, { universityId });
  const createInvite = useMutation(api.invites.create);
  const resendInvite = useMutation(api.invites.resendEmail);
  const revokeInvite = useMutation(api.invites.revoke);
  return (
    <InvitesBoard
      invites={invites}
      canInviteAdmins={canInviteAdmins}
      onCreate={(args) => createInvite({ universityId, ...args })}
      onResend={(inviteId) => resendInvite({ inviteId })}
      onRevoke={(inviteId) => revokeInvite({ inviteId })}
    />
  );
}
