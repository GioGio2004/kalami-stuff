import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import { STUDENT_APP_URL } from "@/lib/urls";

// Shapes the group screens work with, derived from the backend so they can't drift.

export type GroupSummary = FunctionReturnType<typeof api.groups.listMine>[number];
export type GroupDetail = FunctionReturnType<typeof api.groups.get>;
export type GroupMember = GroupDetail["memberList"][number];
export type GroupInvite = GroupDetail["inviteList"][number];
export type InviteResult = FunctionReturnType<typeof api.groups.invite>;
export type CourseGroups = FunctionReturnType<typeof api.groups.forCourse>;

/** The group's shared link, as students open it in the student app. */
export function groupJoinUrl(inviteCode: string): string {
  return `${STUDENT_APP_URL.replace(/\/+$/, "")}/join/${inviteCode}`;
}
