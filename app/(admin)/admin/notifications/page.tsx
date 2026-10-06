"use client";

import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { useCallback, useState } from "react";
import { useAdminScope, useMinute } from "@/components/admin/panel/AdminScope";
import { BroadcastDetailDialog } from "@/components/admin/panel/BroadcastDetail";
import { NotificationsView } from "@/components/admin/panel/NotificationsView";
import { listStatusOf, type BroadcastAudience } from "@/components/admin/types";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useDebounced } from "@/lib/useDebounced";

const PAGE = 50;

export default function NotificationsPage() {
  const scope = useAdminScope();
  const now = useMinute();
  const [audience, setAudience] = useState<BroadcastAudience | null>(null);
  const [emailEveryone, setEmailEveryone] = useState(false);
  const onAudience = useCallback((next: BroadcastAudience | null, everyone: boolean) => {
    setAudience(next);
    setEmailEveryone(everyone);
  }, []);
  const preview = useQuery(api.platform.broadcastPreview, scope.ready && audience !== null ? { audience, emailEveryone } : "skip");
  const history = useQuery(api.platform.broadcasts, scope.ready ? {} : "skip");
  const groups = useQuery(api.platform.groups, scope.ready ? { university: scope.filter } : "skip");

  const [courseQuery, setCourseQuery] = useState("");
  const courseSearched = useDebounced(courseQuery);
  const courses = useQuery(
    api.platform.findCourses,
    scope.ready && courseSearched.trim() !== "" ? { university: scope.filter, query: courseSearched } : "skip",
  );
  const [peopleQuery, setPeopleQuery] = useState("");
  const peopleSearched = useDebounced(peopleQuery);
  const people = useQuery(api.platform.findPeople, scope.ready && peopleSearched.trim().length >= 2 ? { query: peopleSearched } : "skip");

  const send = useMutation(api.platform.sendBroadcast);
  const [openId, setOpenId] = useState<Id<"broadcasts"> | null>(null);
  const recipients = usePaginatedQuery(api.platform.broadcastRecipients, openId === null ? "skip" : { broadcastId: openId }, {
    initialNumItems: PAGE,
  });

  return (
    <>
      <NotificationsView
        universities={scope.universities}
        filter={scope.filter}
        isSuperAdmin={scope.isSuperAdmin}
        scopeLabel={scope.label}
        groups={groups}
        courses={courseSearched === courseQuery ? courses : undefined}
        courseQuery={courseQuery}
        onCourseQuery={setCourseQuery}
        people={peopleSearched === peopleQuery ? people : undefined}
        peopleQuery={peopleQuery}
        onPeopleQuery={setPeopleQuery}
        preview={preview}
        onAudience={onAudience}
        history={history}
        now={now}
        onOpen={setOpenId}
        onSend={async (args) => {
          await send(args);
        }}
      />
      <BroadcastDetailDialog
        broadcast={history?.find((row) => row._id === openId)}
        recipients={recipients.status === "LoadingFirstPage" ? undefined : recipients.results}
        status={listStatusOf(recipients.status)}
        onLoadMore={() => recipients.loadMore(PAGE)}
        open={openId !== null}
        onClose={() => setOpenId(null)}
      />
    </>
  );
}
