"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { PicturesContext, type PictureActions } from "@/components/presentations-editor/ImagePicker";
import { AssessmentBuilder } from "@/components/studio/AssessmentBuilder";
import { LoadingScreen } from "@/components/ui/StatusScreen";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { postFile } from "@/lib/upload";

export default function AssessmentPage() {
  const params = useParams<{ courseId: string; assessmentId: string }>();
  const courseId = params.courseId as Id<"courses">;
  const assessmentId = params.assessmentId as Id<"assessments">;
  const router = useRouter();
  // While a delete runs the query is paused, otherwise it would answer NOT_FOUND
  // (and show the error page) before we get to navigate away. The page keeps
  // showing the last result meanwhile.
  const [deleting, setDeleting] = useState(false);
  const live = useQuery(api.assessments.get, deleting ? "skip" : { assessmentId });
  const [last, setLast] = useState(live);
  if (live !== undefined && live !== last) {
    setLast(live);
  }
  const detail = live ?? (deleting ? last : undefined);
  const update = useMutation(api.assessments.update);
  const setStatus = useMutation(api.assessments.setStatus);
  const remove = useMutation(api.assessments.remove);
  const addQuestions = useMutation(api.questions.add);
  const updateQuestion = useMutation(api.questions.update);
  const removeQuestion = useMutation(api.questions.remove);
  const reorder = useMutation(api.questions.reorder);
  const uploadUrl = useMutation(api.media.generateUploadUrl);
  const uploadPicture = useAction(api.mediaActions.upload);
  const importPicture = useAction(api.mediaActions.importLink);
  // Code task images go to Kalami's ImageKit like presentation pictures: compressed to WebP, in the course's folder.
  const pictures: PictureActions = useMemo(
    () => ({
      upload: async (file, onProgress) => {
        const storageId = await postFile(await uploadUrl({ courseId }), file, onProgress);
        return await uploadPicture({ courseId, storageId: storageId as Id<"_storage">, name: file.name });
      },
      importLink: (url) => importPicture({ courseId, url }),
    }),
    [courseId, uploadUrl, uploadPicture, importPicture],
  );

  if (detail === undefined) {
    return <LoadingScreen label="Opening assessment" />;
  }

  return (
    <PicturesContext.Provider value={pictures}>
    <AssessmentBuilder
      detail={detail}
      onUpdate={async (args) => {
        await update({ assessmentId, ...args });
      }}
      onSetStatus={async (status) => {
        await setStatus({ assessmentId, status });
      }}
      onDelete={async () => {
        setDeleting(true);
        try {
          await remove({ assessmentId });
        } catch (error) {
          setDeleting(false);
          throw error;
        }
        router.push(`/courses/${courseId}`);
      }}
      onAddQuestion={async (input) => {
        await addQuestions({ assessmentId, questions: [input] });
      }}
      onUpdateQuestion={async (questionId, input) => {
        await updateQuestion({ questionId, question: input });
      }}
      onDeleteQuestion={async (questionId) => {
        await removeQuestion({ questionId });
      }}
      onReorder={async (questionIds) => {
        await reorder({ assessmentId, questionIds });
      }}
    />
    </PicturesContext.Provider>
  );
}
