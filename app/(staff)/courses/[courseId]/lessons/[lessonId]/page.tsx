"use client";

import { useMutation, useQuery } from "convex/react";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { LessonEditor } from "@/components/lessons-editor/LessonEditor";
import { LoadingScreen } from "@/components/ui/StatusScreen";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

// A lesson that doesn't exist, or isn't ours, makes the query throw; the
// (staff) error boundary turns that into a "not found" screen.
export default function LessonPage() {
  const params = useParams<{ courseId: string; lessonId: string }>();
  const courseId = params.courseId as Id<"courses">;
  const lessonId = params.lessonId as Id<"lessons">;
  const router = useRouter();
  // While a delete runs the query is paused, otherwise it would answer NOT_FOUND
  // (and show the error page) before we get to navigate away.
  const [deleting, setDeleting] = useState(false);
  const live = useQuery(api.lessons.get, deleting ? "skip" : { lessonId });
  const [last, setLast] = useState(live);
  if (live !== undefined && live !== last) {
    setLast(live);
  }
  const lesson = live ?? (deleting ? last : undefined);
  const rename = useMutation(api.lessons.update);
  const saveBlocks = useMutation(api.lessons.saveBlocks);
  const setStatus = useMutation(api.lessons.setStatus);
  const remove = useMutation(api.lessons.remove);

  if (lesson === undefined) {
    return <LoadingScreen label="Opening lesson" />;
  }

  return (
    <LessonEditor
      key={lesson._id}
      lesson={lesson}
      onRename={async (title) => {
        await rename({ lessonId, title });
      }}
      onSaveBlocks={(blocks) => saveBlocks({ lessonId, blocks })}
      onSetStatus={async (status) => {
        await setStatus({ lessonId, status });
      }}
      onDelete={async () => {
        setDeleting(true);
        try {
          await remove({ lessonId });
        } catch (error) {
          setDeleting(false);
          throw error;
        }
        router.push(`/courses/${courseId}`);
      }}
    />
  );
}
