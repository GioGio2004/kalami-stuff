"use client";

import { useUser } from "@clerk/nextjs";
import { useAction, useMutation, useQuery } from "convex/react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CourseGroups } from "@/components/studio/CourseGroups";
import { CourseMaterials, type DriveConnection } from "@/components/studio/CourseMaterials";
import { CourseView } from "@/components/studio/CourseView";
import { LoadingScreen } from "@/components/ui/StatusScreen";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { DRIVE_SCOPE } from "@/lib/drive";

// A course that doesn't exist, or isn't ours, makes the query throw; the
// (staff) error boundary turns that into a "not found" screen.
export default function CoursePage() {
  const { courseId } = useParams<{ courseId: string }>();
  const id = courseId as Id<"courses">;
  const router = useRouter();
  const course = useQuery(api.courses.get, { courseId: id });
  const history = useQuery(api.audit.recentForCourse, { courseId: id });
  const updateCourse = useMutation(api.courses.update);
  const createAssessment = useMutation(api.assessments.create);
  const newJoinCode = useMutation(api.courses.newJoinCode);
  const setJoining = useMutation(api.courses.setJoining);

  const canEdit = course?.canEdit === true;
  const groups = useQuery(api.groups.forCourse, canEdit ? { courseId: id } : "skip");
  const shareCourse = useMutation(api.groups.shareCourse);
  const unshareCourse = useMutation(api.groups.unshareCourse);

  // The clock only flags Drive jobs that stopped reporting back; a minute is fine.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const materials = useQuery(api.materials.forCourse, { courseId: id, now });
  const addDrive = useMutation(api.materials.addDrive);
  const addLink = useMutation(api.materials.addLink);
  const updateWeek = useMutation(api.materials.update);
  const moveWeek = useMutation(api.materials.move);
  const publishWeek = useMutation(api.materials.publish);
  const unpublishWeek = useMutation(api.materials.unpublish);
  const removeWeek = useMutation(api.materials.remove);
  const retryWeek = useMutation(api.materials.retry);
  const moveToMyDrive = useMutation(api.materials.moveToMyDrive);

  const { user } = useUser();
  const checkConnection = useAction(api.drive.connection);
  const [connection, setConnection] = useState<DriveConnection | undefined>(undefined);
  const refreshConnection = useCallback(() => {
    checkConnection({})
      .then(setConnection)
      .catch(() => setConnection({ available: true, connected: false, problem: "Couldn't check Google Drive. Reload to try again." }));
  }, [checkConnection]);
  useEffect(() => {
    if (!canEdit) return;
    // Back from Google's consent screen: Clerk has the new permission; refresh what we know.
    if (new URLSearchParams(window.location.search).has("drive")) {
      void user?.reload().finally(refreshConnection);
      router.replace(`/courses/${id}`);
      return;
    }
    refreshConnection();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per course, plus the return from Google.
  }, [canEdit, id]);

  if (course === undefined) {
    return <LoadingScreen label="Opening course" />;
  }

  return (
    <CourseView
      course={course}
      history={history}
      onUpdateCourse={async (args) => {
        await updateCourse({ courseId: id, ...args });
      }}
      onCreateAssessment={async (args) => {
        const assessmentId = await createAssessment({ courseId: id, ...args });
        router.push(`/courses/${id}/assessments/${assessmentId}`);
      }}
      onNewJoinCode={async () => {
        await newJoinCode({ courseId: id });
      }}
      onSetJoining={async (enabled) => {
        await setJoining({ courseId: id, enabled });
      }}
      groups={
        canEdit ? (
          <CourseGroups
            groups={groups}
            canEdit={course.status !== "archived"}
            onShare={async (groupId) => {
              await shareCourse({ groupId, courseId: id });
            }}
            onUnshare={async (groupId) => {
              await unshareCourse({ groupId, courseId: id });
            }}
          />
        ) : undefined
      }
      materials={
        <CourseMaterials
          data={materials}
          connection={connection}
          actions={{
            onConnectDrive: async () => {
              if (!user) throw new Error("Sign in again, then connect Google Drive.");
              const redirectUrl = `${window.location.origin}/courses/${id}?drive=connected`;
              const google = user.externalAccounts.find((account) => account.provider === "google");
              // Asks Google, through Clerk, for one more permission on the account they already use;
              // without a Google account attached, attaches one with that permission.
              const account = google
                ? await google.reauthorize({ additionalScopes: [DRIVE_SCOPE], redirectUrl })
                : await user.createExternalAccount({ strategy: "oauth_google", additionalScopes: [DRIVE_SCOPE], redirectUrl });
              const next = account.verification?.externalVerificationRedirectURL;
              if (!next) throw new Error("Google didn't open. Try again.");
              window.location.assign(next.href);
            },
            onAddDrive: async (args) => {
              await addDrive({ courseId: id, ...args });
            },
            onAddLink: async (args) => {
              await addLink({ courseId: id, ...args });
            },
            onUpdate: async (materialId, patch) => {
              await updateWeek({ materialId, ...patch });
            },
            onMove: async (materialId, direction) => {
              await moveWeek({ materialId, direction });
            },
            onPublish: async (materialId) => {
              await publishWeek({ materialId });
            },
            onUnpublish: async (materialId) => {
              await unpublishWeek({ materialId });
            },
            onRemove: async (materialId) => {
              await removeWeek({ materialId });
            },
            onRetry: async (materialId) => {
              await retryWeek({ materialId });
            },
            onMoveToMyDrive: async () => {
              await moveToMyDrive({ courseId: id });
            },
          }}
        />
      }
    />
  );
}
