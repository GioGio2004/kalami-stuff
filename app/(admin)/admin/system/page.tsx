"use client";

import { useMutation, useQuery } from "convex/react";
import { useAdminScope, useMinute } from "@/components/admin/panel/AdminScope";
import { SystemView } from "@/components/admin/panel/SystemView";
import { PanelHeader } from "@/components/admin/panel/ui";
import { api } from "@/convex/_generated/api";

export default function SystemPage() {
  const scope = useAdminScope();
  const now = useMinute();
  const system = useQuery(api.platform.system, scope.isSuperAdmin ? { now } : "skip");
  const allow = useMutation(api.platform.clearEmailSuppression);
  if (!scope.isSuperAdmin) {
    return <PanelHeader note="Platform" title="System" description="Only the platform admin sees this page." />;
  }
  return (
    <SystemView
      system={system}
      onAllowEmail={async (email) => {
        await allow({ email });
      }}
    />
  );
}
