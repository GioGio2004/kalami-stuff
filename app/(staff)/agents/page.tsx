"use client";

import { useMutation, useQuery } from "convex/react";
import { AgentsView } from "@/components/agents/AgentsView";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { api } from "@/convex/_generated/api";

export default function AgentsPage() {
  const current = useCurrentUser();
  const ready = current.status === "ready";
  const tokens = useQuery(api.mcpTokens.list, ready ? {} : "skip");
  const createToken = useMutation(api.mcpTokens.create);
  const revokeToken = useMutation(api.mcpTokens.revoke);

  // StaffGate only renders this page for signed-in staff.
  if (!ready) {
    return null;
  }
  return (
    <AgentsView
      tokens={tokens}
      onCreateToken={async (name) => (await createToken({ name })).token}
      onRevokeToken={async (tokenId) => {
        await revokeToken({ tokenId });
      }}
    />
  );
}
