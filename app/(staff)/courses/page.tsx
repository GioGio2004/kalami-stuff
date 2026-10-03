"use client";

import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { StudioDashboard } from "@/components/studio/StudioDashboard";
import { api } from "@/convex/_generated/api";

export default function CoursesPage() {
  const current = useCurrentUser();
  const router = useRouter();
  const ready = current.status === "ready";
  const courses = useQuery(api.courses.listMine, ready ? {} : "skip");
  const activity = useQuery(api.audit.recentForMe, ready ? {} : "skip");
  const universities = useQuery(api.courses.universitiesForNewCourse, ready ? {} : "skip");
  const createCourse = useMutation(api.courses.create);
  const markIntroSeen = useMutation(api.users.markStudioIntroSeen);

  // StaffGate only renders this page for signed-in staff.
  if (!ready) {
    return null;
  }
  return (
    <StudioDashboard
      me={current.me}
      courses={courses}
      activity={activity}
      universities={universities}
      introOpenInitially={current.me.studioIntroSeenAt === undefined}
      onCreateCourse={async (args) => {
        const courseId = await createCourse(args);
        router.push(`/courses/${courseId}`);
      }}
      onIntroSeen={() => {
        // Best effort: if it fails, the intro simply shows again next visit.
        markIntroSeen().catch(() => {});
      }}
    />
  );
}
