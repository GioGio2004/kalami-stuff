"use client";

import { useMutation, useQuery } from "convex/react";
import { InviteCenter } from "@/components/admin/InviteCenter";
import type { AdminUniversity } from "@/components/admin/AdminView";
import { api } from "@/convex/_generated/api";

/** The super admin's invite form (with a university picker) and every invite, in one place. */
export function SuperAdminInvites({ universities }: { universities: AdminUniversity[] | undefined }) {
  const invites = useQuery(api.invites.listAll, {});
  const createInvite = useMutation(api.invites.create);
  const resendInvite = useMutation(api.invites.resendEmail);
  const revokeInvite = useMutation(api.invites.revoke);
  return (
    <InviteCenter
      universities={universities}
      invites={invites}
      onCreate={(args) => createInvite(args)}
      onResend={(inviteId) => resendInvite({ inviteId })}
      onRevoke={(inviteId) => revokeInvite({ inviteId })}
    />
  );
}
