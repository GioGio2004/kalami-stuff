"use client";

import { useMutation, useQuery } from "convex/react";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { AssessmentBuilder } from "@/components/studio/AssessmentBuilder";
import { LoadingScreen } from "@/components/ui/StatusScreen";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

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

  if (detail === undefined) {
    return <LoadingScreen label="Opening assessment" />;
  }

  return (
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
  );
}
