"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/buttons";
import { SelectInput } from "@/components/ui/form";
import { Users } from "@/components/ui/icons";
import { Pill } from "@/components/ui/Pill";
import { errorMessage } from "@/lib/errors";
import type { CourseGroups as CourseGroupsData } from "@/components/groups/types";

type GroupId = CourseGroupsData["shared"][number]["_id"];

/** The course page's "who gets this course" card: the groups it's shared with. */
export function CourseGroups({
  groups,
  canEdit,
  onShare,
  onUnshare,
}: {
  groups: CourseGroupsData | undefined;
  canEdit: boolean;
  onShare: (groupId: GroupId) => Promise<void>;
  onUnshare: (groupId: GroupId) => Promise<void>;
}) {
  const [picked, setPicked] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-[2rem] bg-card p-6">
      <span className="grid size-11 place-items-center rounded-full bg-highlighter text-ink">
        <Users className="size-5" />
      </span>
      <h2 className="mt-5 text-xl font-medium tracking-tight">Groups</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-graphite">
        Share the course with the groups you teach and every student in them gets it, including those who join later.
      </p>
      {groups === undefined ? (
        <p className="mt-4 text-sm text-graphite">Loading…</p>
      ) : (
        <>
          {groups.shared.length > 0 && (
            <ul className="mt-4 space-y-2">
              {groups.shared.map((group) => (
                <li key={group._id} className="rounded-2xl border border-line bg-paper py-2.5 pl-4 pr-2">
                  <Link href={`/groups/${group._id}`} className="block break-words pr-2 text-sm font-medium hover:underline">
                    {group.name}
                  </Link>
                  <div className="mt-1 flex min-h-9 items-center gap-2">
                    <span className="flex-1 text-xs text-graphite">
                      {group.members} student{group.members === 1 ? "" : "s"}
                    </span>
                    {group.archived && <Pill>Archived</Pill>}
                    {canEdit && (
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => onUnshare(group._id))}>
                        Unshare
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {canEdit && groups.available.length > 0 && (
            <div className="mt-4 flex flex-col gap-2 sm:flex-row lg:flex-col xl:flex-row">
              <SelectInput aria-label="Group to share with" value={picked} onChange={(e) => setPicked(e.target.value)}>
                <option value="">Share with a group…</option>
                {groups.available.map((group) => (
                  <option key={group._id} value={group._id}>
                    {group.name} ({group.members})
                  </option>
                ))}
              </SelectInput>
              <Button
                disabled={busy || picked === ""}
                onClick={() =>
                  run(async () => {
                    await onShare(picked as GroupId);
                    setPicked("");
                  })
                }
              >
                Share
              </Button>
            </div>
          )}
          {canEdit && groups.available.length === 0 && (
            <p className="mt-4 text-sm text-graphite">
              <Link href="/groups" className="font-medium text-ink underline underline-offset-4">
                {groups.shared.length === 0 ? "Find your group" : "Find another group"}
              </Link>{" "}
              under Groups and join it, then share this course with it.
            </p>
          )}
        </>
      )}
      {error && <p className="mt-3 text-sm text-red-pen">{error}</p>}
    </section>
  );
}
