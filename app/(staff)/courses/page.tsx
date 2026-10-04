"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { KalamiDropOverlay } from "@/components/kalami/KalamiDropOverlay";
import { KalamiImport } from "@/components/kalami/KalamiImport";
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
  const inspect = useAction(api.kalami.inspect);
  const importCourse = useAction(api.kalami.importCourse);
  const [importing, setImporting] = useState<{ open: boolean; file: File | null }>({ open: false, file: null });

  // StaffGate only renders this page for signed-in staff.
  if (!ready) {
    return null;
  }
  return (
    <>
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
        onImportKalami={() => setImporting({ open: true, file: null })}
      />
      <KalamiDropOverlay onFile={(file) => setImporting({ open: true, file })} />
      <KalamiImport
        open={importing.open}
        file={importing.file}
        universities={universities}
        onClose={() => setImporting({ open: false, file: null })}
        onInspect={(text) => inspect({ text })}
        onImport={async (text, universityId) => {
          const result = await importCourse({ text, universityId });
          if (result.ok) {
            router.push(`/courses/${result.courseId}`);
          }
          return result;
        }}
      />
    </>
  );
}
