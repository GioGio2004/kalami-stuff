"use client";

import { useUser } from "@clerk/nextjs";
import { useAction, useConvex, useMutation, useQuery } from "convex/react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CourseGroups } from "@/components/studio/CourseGroups";
import { CourseOutline } from "@/components/studio/CourseOutline";
import { CourseView } from "@/components/studio/CourseView";
import type { DriveConnection } from "@/components/studio/types";
import { downloadKalami } from "@/components/kalami/KalamiFile";
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
  const convex = useConvex();
  const course = useQuery(api.courses.get, { courseId: id });
  const updateCourse = useMutation(api.courses.update);
  const newJoinCode = useMutation(api.courses.newJoinCode);
  const setJoining = useMutation(api.courses.setJoining);

  const canEdit = course?.canEdit === true;
  const groups = useQuery(api.groups.forCourse, canEdit ? { courseId: id } : "skip");
  const shareCourse = useMutation(api.groups.shareCourse);
  const unshareCourse = useMutation(api.groups.unshareCourse);

  // The clock only flags Drive jobs that stopped reporting back; half a minute is fine.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const outline = useQuery(api.weeks.outline, { courseId: id, now });
  const createWeek = useMutation(api.weeks.create);
  const updateWeek = useMutation(api.weeks.update);
  const moveWeek = useMutation(api.weeks.move);
  const publishWeek = useMutation(api.weeks.publish);
  const unpublishWeek = useMutation(api.weeks.unpublish);
  const removeWeek = useMutation(api.weeks.remove);
  const addLinks = useMutation(api.weeks.addLinksTo);
  const updateLink = useMutation(api.weeks.updateLinkIn);
  const removeLink = useMutation(api.weeks.removeLinkFrom);
  const moveLink = useMutation(api.weeks.moveLinkIn);
  const addFolder = useMutation(api.weeks.addFolder);
  const retryDrive = useMutation(api.weeks.retry);
  const moveToMyDrive = useMutation(api.weeks.moveToMyDrive);
  const place = useMutation(api.weeks.place);
  const createLesson = useMutation(api.lessons.create);
  const createPresentation = useMutation(api.presentations.create);
  const moveLesson = useMutation(api.lessons.move);
  const createAssessment = useMutation(api.assessments.create);

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
      onExport={
        course.canEdit
          ? async () => {
              const { fileName, content } = await convex.query(api.kalami.exportCourse, { courseId: id });
              downloadKalami(fileName, content);
            }
          : undefined
      }
      onUpdateCourse={async (args) => {
        await updateCourse({ courseId: id, ...args });
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
      outline={
        <CourseOutline
          data={outline}
          connection={connection}
          locale={course.locale}
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
            onMoveToMyDrive: async () => {
              await moveToMyDrive({ courseId: id });
            },
            onCreateWeek: async (args) => await createWeek({ courseId: id, ...args }),
            onUpdateWeek: async (weekId, patch) => {
              await updateWeek({ weekId, ...patch });
            },
            onMoveWeek: async (weekId, direction) => {
              await moveWeek({ weekId, direction });
            },
            onPublishWeek: async (weekId) => {
              await publishWeek({ weekId });
            },
            onUnpublishWeek: async (weekId) => {
              await unpublishWeek({ weekId });
            },
            onRemoveWeek: async (weekId) => {
              await removeWeek({ weekId });
            },
            onAddLink: async (weekId, link) => {
              await addLinks({ weekId, links: [link] });
            },
            onUpdateLink: async (weekId, linkId, link) => {
              await updateLink({ weekId, linkId, ...link });
            },
            onRemoveLink: async (weekId, linkId) => {
              await removeLink({ weekId, linkId });
            },
            onMoveLink: async (weekId, linkId, direction) => {
              await moveLink({ weekId, linkId, direction });
            },
            onAddFolder: async (weekId) => {
              await addFolder({ weekId });
            },
            onRetryDrive: async (weekId) => {
              await retryDrive({ weekId });
            },
            onCreateLesson: async (weekId, title) => {
              const lessonId = await createLesson({ weekId, title });
              router.push(`/courses/${id}/lessons/${lessonId}`);
            },
            onCreatePresentation: async (weekId, title) => {
              const presentationId = await createPresentation({ weekId, title });
              router.push(`/courses/${id}/presentations/${presentationId}`);
            },
            onMoveLesson: async (lessonId, direction) => {
              await moveLesson({ lessonId, direction });
            },
            onCreateAssessment: async (args) => {
              const assessmentId = await createAssessment({ courseId: id, ...args });
              router.push(`/courses/${id}/assessments/${assessmentId}`);
            },
            onPlace: async (assessmentId, weekId) => {
              await place({ assessmentId, weekId });
            },
          }}
        />
      }
    />
  );
}
