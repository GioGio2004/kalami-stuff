"use client";

import { useMutation, useQuery } from "convex/react";
import { useParams, useRouter } from "next/navigation";
import { CourseView } from "@/components/studio/CourseView";
import { LoadingScreen } from "@/components/ui/StatusScreen";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

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
    />
  );
}
