import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";

// Shapes the inbox screens work with, derived from the backend so they can't drift.

export type InboxItem = FunctionReturnType<typeof api.messages.inbox>[number];
export type Thread = FunctionReturnType<typeof api.messages.thread>;
export type ThreadMessage = Thread["messages"][number];
export type Topic = InboxItem["topic"];
export type ConversationStatus = InboxItem["status"];

/** The student app's topic labels, in English, for staff. */
export const TOPIC_LABEL: Record<Topic, string> = {
  materials_access: "Can't open the materials",
  missing_material: "A file or link is missing",
  assignment: "Assignment question",
  grade: "Grade or feedback",
  submission: "Couldn't submit",
  absence: "Absence or schedule",
  app_problem: "Kalami isn't working",
  other: "Own topic",
};

/** How a status reads from the staff side. */
export const STAFF_STATUS_LABEL: Record<ConversationStatus, string> = {
  open: "Needs your reply",
  answered: "Replied",
  resolved: "Resolved",
};

export function topicText(item: { topic: Topic; customTopic?: string }): string {
  return item.topic === "other" && item.customTopic ? item.customTopic : TOPIC_LABEL[item.topic];
}

/** A fresh id for one Send, so a double click or a retry after a timeout is saved once. */
export function newClientOpId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
