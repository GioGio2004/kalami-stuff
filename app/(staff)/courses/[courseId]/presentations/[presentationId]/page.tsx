"use client";

import { useMutation, useQuery } from "convex/react";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { PresentationEditor } from "@/components/presentations-editor/PresentationEditor";
import { LoadingScreen } from "@/components/ui/StatusScreen";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

// A presentation that doesn't exist, or isn't ours, makes the query throw; the
// (staff) error boundary turns that into a "not found" screen.
export default function PresentationPage() {
  const params = useParams<{ courseId: string; presentationId: string }>();
  const courseId = params.courseId as Id<"courses">;
  const presentationId = params.presentationId as Id<"presentations">;
  const router = useRouter();
  // While a delete runs the query is paused, otherwise it would answer NOT_FOUND
  // (and show the error page) before we get to navigate away.
  const [deleting, setDeleting] = useState(false);
  const live = useQuery(api.presentations.get, deleting ? "skip" : { presentationId });
  const [last, setLast] = useState(live);
  if (live !== undefined && live !== last) {
    setLast(live);
  }
  const deck = live ?? (deleting ? last : undefined);
  const save = useMutation(api.presentations.save);
  const setStatus = useMutation(api.presentations.setStatus);
  const remove = useMutation(api.presentations.remove);

  if (deck === undefined) {
    return <LoadingScreen label="Opening presentation" />;
  }

  return (
    <PresentationEditor
      key={deck._id}
      deck={deck}
      onRename={async (title) => {
        await save({ presentationId, title });
      }}
      onSave={(draft) => save({ presentationId, theme: draft.theme, slides: draft.slides })}
      onSetStatus={async (status) => {
        await setStatus({ presentationId, status });
      }}
      onDelete={async () => {
        setDeleting(true);
        try {
          await remove({ presentationId });
        } catch (error) {
          setDeleting(false);
          throw error;
        }
        router.push(`/courses/${courseId}`);
      }}
    />
  );
}
