import type { FunctionArgs, FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";

// Shapes the studio screens work with, derived from the backend so they can't drift.

export type CourseSummary = FunctionReturnType<typeof api.courses.listMine>[number];
export type CourseDetail = FunctionReturnType<typeof api.courses.get>;
export type Assessment = CourseDetail["assessments"][number];
export type AssessmentDetail = FunctionReturnType<typeof api.assessments.get>;
export type QuestionWithKey = AssessmentDetail["questions"][number];
export type QuestionInput = FunctionArgs<typeof api.questions.add>["questions"][number];
export type QuestionType = QuestionInput["type"];
export type AssessmentSettings = Assessment["settings"];
export type AssessmentKind = Assessment["kind"];
export type AssessmentStatus = Assessment["status"];
export type AuditEntry = FunctionReturnType<typeof api.audit.recentForMe>[number];
export type UniversityOption = FunctionReturnType<typeof api.courses.universitiesForNewCourse>[number];

export type NewCourseArgs = FunctionArgs<typeof api.courses.create>;
export type UpdateCourseArgs = Omit<FunctionArgs<typeof api.courses.update>, "courseId">;
export type NewAssessmentArgs = Omit<FunctionArgs<typeof api.assessments.create>, "courseId">;
export type UpdateAssessmentArgs = Omit<FunctionArgs<typeof api.assessments.update>, "assessmentId">;

export const KIND_LABEL: Record<AssessmentKind, string> = {
  task: "Task",
  quiz: "Quiz",
  midterm: "Midterm",
  final: "Final exam",
};

export const TYPE_LABEL: Record<QuestionType, string> = {
  single: "Single choice",
  multiple: "Multiple choice",
  short: "Short answer",
  essay: "Essay",
  code: "Code task",
};

export const INTEGRITY_LABEL: Record<AssessmentSettings["integrityLevel"], string> = {
  off: "Practice",
  standard: "Standard",
  strict: "Strict",
};

export const RESULTS_LABEL: Record<AssessmentSettings["resultsVisibility"], string> = {
  hidden: "Hidden",
  score: "Score only",
  full_after_close: "Full, after close",
};
