"use client";

import { useMutation, useQuery } from "convex/react";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { CrosswordEditor } from "@/components/crossword-editor/CrosswordEditor";
import { LoadingScreen } from "@/components/ui/StatusScreen";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

// A crossword that doesn't exist, or isn't ours, makes the query throw; the
// (staff) error boundary turns that into a "not found" screen.
export default function CrosswordPage() {
  const params = useParams<{ courseId: string; crosswordId: string }>();
  const crosswordId = params.crosswordId as Id<"crosswords">;
  const router = useRouter();
  // While a delete runs the query is paused, so it doesn't answer NOT_FOUND before we navigate away.
  const [deleting, setDeleting] = useState(false);
  const live = useQuery(api.crosswords.get, deleting ? "skip" : { crosswordId });
  const [last, setLast] = useState(live);
  if (live !== undefined && live !== last) {
    setLast(live);
  }
  const crossword = live ?? (deleting ? last : undefined);
  const save = useMutation(api.crosswords.save);
  const setStatus = useMutation(api.crosswords.setStatus);
  const remove = useMutation(api.crosswords.remove);

  if (crossword === undefined) {
    return <LoadingScreen label="Opening crossword" />;
  }

  return (
    <CrosswordEditor
      key={crossword._id}
      crossword={crossword}
      onRename={async (title) => {
        await save({ crosswordId, title });
      }}
      onSave={(entries) => save({ crosswordId, entries })}
      onSetStatus={async (status) => {
        await setStatus({ crosswordId, status });
      }}
      onDelete={async () => {
        setDeleting(true);
        try {
          await remove({ crosswordId });
        } catch (error) {
          setDeleting(false);
          throw error;
        }
        router.push(`/courses/${params.courseId}#week-${crossword.weekId}`);
      }}
    />
  );
}
