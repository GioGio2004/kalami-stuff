import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Actor } from "../lib/access";
import { viaValidator } from "../lib/validators";

/** Every studio change is recorded, with whether a person or their agent made it. */
export async function logAudit(
  ctx: MutationCtx,
  actor: Actor,
  entry: {
    action: string;
    targetTable: string;
    targetId: string;
    courseId?: Id<"courses">;
    summary: string;
  },
): Promise<void> {
  await ctx.db.insert("auditLog", {
    actorId: actor.user._id,
    via: actor.via,
    ...entry,
    at: Date.now(),
  });
}

export const auditEntryValidator = v.object({
  _id: v.id("auditLog"),
  via: viaValidator,
  action: v.string(),
  targetTable: v.string(),
  targetId: v.string(),
  courseId: v.optional(v.id("courses")),
  summary: v.string(),
  at: v.number(),
  actorName: v.string(),
  // True when the signed-in person (or their own agent) did it.
  mine: v.boolean(),
});

export function displayName(user: Doc<"users"> | null): string {
  if (user === null) {
    return "Someone";
  }
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
  return name || user.email;
}

export async function toAuditEntries(
  ctx: QueryCtx,
  actor: Actor,
  rows: Doc<"auditLog">[],
) {
  const names = new Map<Id<"users">, string>();
  const entries = [];
  for (const row of rows) {
    let actorName = names.get(row.actorId);
    if (actorName === undefined) {
      actorName = displayName(await ctx.db.get("users", row.actorId));
      names.set(row.actorId, actorName);
    }
    entries.push({
      _id: row._id,
      via: row.via,
      action: row.action,
      targetTable: row.targetTable,
      targetId: row.targetId,
      courseId: row.courseId,
      summary: row.summary,
      at: row.at,
      actorName,
      mine: row.actorId === actor.user._id,
    });
  }
  return entries;
}
