"use client";

import { useQuery } from "convex/react";
import { useAdminScope, useMinute } from "@/components/admin/panel/AdminScope";
import { OverviewView } from "@/components/admin/panel/OverviewView";
import { api } from "@/convex/_generated/api";

export default function AdminOverviewPage() {
  const scope = useAdminScope();
  const now = useMinute();
  const overview = useQuery(api.platform.overview, scope.ready ? { university: scope.filter, now } : "skip");
  return <OverviewView overview={overview} scopeLabel={scope.label} now={now} />;
}
