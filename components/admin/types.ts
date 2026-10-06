import type { FunctionArgs, FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

// Shapes the admin panel works with, derived from the backend so they can't drift.

export type AdminUniversity = FunctionReturnType<typeof api.universities.listAdministered>[number];

/** Which universities a page is about: one, "none" (outside any university), or everything the caller administers. */
export type UniversityFilter = Id<"universities"> | "none" | undefined;

export type Overview = FunctionReturnType<typeof api.platform.overview>;
export type UniversityRow = FunctionReturnType<typeof api.platform.universities>[number];
export type StudentRow = FunctionReturnType<typeof api.platform.students>["page"][number];
export type StudentDetail = FunctionReturnType<typeof api.platform.student>;
export type StaffRow = FunctionReturnType<typeof api.platform.staff>[number];
export type StaffDetail = FunctionReturnType<typeof api.platform.staffMember>;
export type CourseRow = FunctionReturnType<typeof api.platform.courses>["page"][number];
export type AdminCourseDetail = FunctionReturnType<typeof api.platform.course>;
export type GroupRow = FunctionReturnType<typeof api.platform.groups>[number];
export type AuditLine = FunctionReturnType<typeof api.platform.activity>["page"][number];
export type SystemInfo = FunctionReturnType<typeof api.platform.system>;
export type BroadcastRow = FunctionReturnType<typeof api.platform.broadcasts>[number];
export type DeliveryRow = FunctionReturnType<typeof api.platform.broadcastRecipients>["page"][number];
export type AudiencePreview = FunctionReturnType<typeof api.platform.broadcastPreview>;
export type PersonHit = FunctionReturnType<typeof api.platform.findPeople>[number];
export type BroadcastArgs = FunctionArgs<typeof api.platform.sendBroadcast>;
export type BroadcastAudience = BroadcastArgs["audience"];

/** How a paginated list stands: still loading, more to load, or everything shown. */
export type ListStatus = "loading" | "more" | "done" | "loading-more";

export const ROLE_LABEL = {
  student: "Student",
  lecturer: "Lecturer",
  uni_admin: "University admin",
  super_admin: "Platform admin",
} as const;

export const KIND_LABEL = { task: "Task", quiz: "Quiz", midterm: "Midterm", final: "Final" } as const;

/** The university picker's values for "everything" and "outside any university". */
export const ALL = "all";
export const NONE = "none";

/** usePaginatedQuery's status, as the list footer reads it. */
export function listStatusOf(status: "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted"): ListStatus {
  switch (status) {
    case "LoadingFirstPage":
      return "loading";
    case "CanLoadMore":
      return "more";
    case "LoadingMore":
      return "loading-more";
    default:
      return "done";
  }
}
