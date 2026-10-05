"use client";

import { useMutation, useQuery } from "convex/react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { GroupView } from "@/components/groups/GroupView";
import { LoadingScreen } from "@/components/ui/StatusScreen";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

// A group that doesn't exist, or that we neither run nor teach, makes the query
// throw; the (staff) error boundary turns that into a "not found" screen.
export default function GroupPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const id = groupId as Id<"groups">;
  const group = useQuery(api.groups.get, { groupId: id });
  const courses = useQuery(api.courses.listMine, {});
  const update = useMutation(api.groups.update);
  const newLink = useMutation(api.groups.newInviteLink);
  const setLink = useMutation(api.groups.setInviteLink);
  const invite = useMutation(api.groups.invite);
  const resend = useMutation(api.groups.resendInviteEmail);
  const withdraw = useMutation(api.groups.withdrawInvite);
  const removeStudent = useMutation(api.groups.removeStudent);
  const shareCourse = useMutation(api.groups.shareCourse);
  const unshareCourse = useMutation(api.groups.unshareCourse);
  const leaveGroup = useMutation(api.groups.leaveAsLecturer);
  const removeLecturer = useMutation(api.groups.removeLecturer);
  const router = useRouter();
  // Invite expiry is judged here: queries don't read the clock.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  if (group === undefined) {
    return <LoadingScreen label="Opening group" />;
  }

  return (
    <GroupView
      group={group}
      courses={courses}
      now={now}
      actions={{
        onUpdate: async (patch) => {
          await update({ groupId: id, ...patch });
        },
        onNewLink: async () => {
          await newLink({ groupId: id });
        },
        onSetLink: async (enabled) => {
          await setLink({ groupId: id, enabled });
        },
        onInvite: async (emails) => await invite({ groupId: id, emails: [emails] }),
        onResend: async (inviteId) => await resend({ inviteId }),
        onWithdraw: async (inviteId) => {
          await withdraw({ inviteId });
        },
        onRemoveStudent: async (userId) => {
          await removeStudent({ groupId: id, userId });
        },
        onShareCourse: async (courseId) => {
          await shareCourse({ groupId: id, courseId });
        },
        onUnshareCourse: async (courseId) => {
          await unshareCourse({ groupId: id, courseId });
        },
        onLeave: async () => {
          await leaveGroup({ groupId: id });
          router.push("/groups");
        },
        onRemoveLecturer: async (userId) => {
          await removeLecturer({ groupId: id, userId });
        },
      }}
    />
  );
}
