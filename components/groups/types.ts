import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import { STUDENT_APP_URL } from "@/lib/urls";

// Shapes the group screens work with, derived from the backend so they can't drift.

export type GroupSummary = FunctionReturnType<typeof api.groups.listMine>[number];
export type GroupDetail = FunctionReturnType<typeof api.groups.get>;
export type GroupMember = GroupDetail["memberList"][number];
export type GroupInvite = GroupDetail["inviteList"][number];
export type GroupLecturer = GroupDetail["lecturerList"][number];
export type InviteResult = FunctionReturnType<typeof api.groups.invite>;
export type CourseGroups = FunctionReturnType<typeof api.groups.forCourse>;
export type GroupSearchResult = FunctionReturnType<typeof api.groups.search>[number];
export type UniversityGroup = FunctionReturnType<typeof api.groups.forUniversity>[number];

type Membership = { role: string; universityId?: string };

/**
 * How the Groups page works for someone: a university's lecturer (or admin)
 * finds and joins its groups; a teacher outside any university runs their own;
 * the super admin, who teaches nothing, runs groups from the admin page.
 */
export function groupsMode(memberships: Membership[]): "university" | "independent" | "admin" {
  const atUniversity = memberships.some(
    (m) => (m.role === "lecturer" || m.role === "uni_admin") && m.universityId !== undefined,
  );
  if (atUniversity) return "university";
  return memberships.some((m) => m.role === "lecturer") ? "independent" : "admin";
}

/** The group's shared link, as students open it in the student app. */
export function groupJoinUrl(inviteCode: string): string {
  return `${STUDENT_APP_URL.replace(/\/+$/, "")}/join/${inviteCode}`;
}
