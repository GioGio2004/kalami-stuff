"use client";

import { usePaginatedQuery } from "convex/react";
import { useState } from "react";
import { ActivityView } from "@/components/admin/panel/ActivityView";
import { useAdminScope, useMinute } from "@/components/admin/panel/AdminScope";
import { PanelHeader } from "@/components/admin/panel/ui";
import { listStatusOf } from "@/components/admin/types";
import { api } from "@/convex/_generated/api";

const PAGE = 50;

export default function ActivityPage() {
  const scope = useAdminScope();
  const now = useMinute();
  const [filter, setFilter] = useState("");
  const list = usePaginatedQuery(
    api.platform.activity,
    scope.isSuperAdmin ? { targetTable: filter === "" ? undefined : filter } : "skip",
    { initialNumItems: PAGE },
  );
  if (!scope.isSuperAdmin) {
    return <PanelHeader note="Platform" title="Activity" description="Only the platform admin sees the whole log." />;
  }
  return (
    <ActivityView
      rows={list.status === "LoadingFirstPage" ? undefined : list.results}
      status={listStatusOf(list.status)}
      onLoadMore={() => list.loadMore(PAGE)}
      filter={filter}
      onFilter={setFilter}
      now={now}
    />
  );
}
