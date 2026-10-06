import { v, type Infer } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx, QueryCtx } from "../_generated/server";
import { requireStaffActor, requireTokenActor } from "../lib/access";
import { checkKalami } from "./kalami";

/**
 * Importing a .kalami file: an action checks the whole file first (format,
 * blocks, questions, settings; model/kalami.ts checkKalami), then creates the
 * course in steps (the course, each week with its lessons, each assessment
 * with its questions) through internal mutations in kalami.ts. If a step
 * still fails, the half-made course is removed again, so an import either
 * lands whole or not at all. The result is always a new draft course.
 */

/** Who the import acts for: the signed-in staff member, or an agent with its MCP credential. */
export const importAsValidator = v.union(
  v.object({ kind: v.literal("session") }),
  v.object({
    kind: v.literal("agent"),
    token: v.string(),
    client: v.optional(v.string()),
    // The agent's own id for this call: a retry after a timeout returns the course the first call made.
    requestId: v.optional(v.string()),
  }),
);
export type ImportAs = Infer<typeof importAsValidator>;

export async function actorFor(ctx: QueryCtx, as: ImportAs) {
  return as.kind === "agent" ? await requireTokenActor(ctx, as.token, as.client) : await requireStaffActor(ctx);
}

export const summaryValidator = v.object({
  title: v.string(),
  language: v.union(v.literal("ka"), v.literal("en")),
  weeks: v.number(),
  lessons: v.number(),
  presentations: v.number(),
  assessments: v.object({ task: v.number(), quiz: v.number(), midterm: v.number(), final: v.number() }),
  questions: v.number(),
  links: v.number(),
  exported: v.optional(v.object({ by: v.string(), at: v.string(), from: v.string() })),
});

export const inspectResultValidator = v.union(
  v.object({
    ok: v.literal(true),
    summary: summaryValidator,
    verified: v.union(v.null(), v.object({ by: v.string(), at: v.string() })),
  }),
  v.object({ ok: v.literal(false), errors: v.array(v.string()), summary: v.optional(summaryValidator) }),
);

export const importResultValidator = v.union(
  v.object({
    ok: v.literal(true),
    courseId: v.id("courses"),
    summary: summaryValidator,
    verified: v.union(v.null(), v.object({ by: v.string(), at: v.string() })),
  }),
  v.object({ ok: v.literal(false), errors: v.array(v.string()), summary: v.optional(summaryValidator) }),
);

export type ImportResult = Infer<typeof importResultValidator>;
export type InspectResult = Infer<typeof inspectResultValidator>;

/** Checks a file without writing anything. */
export async function inspectKalami(text: string): Promise<InspectResult> {
  const check = await checkKalami(text);
  return check.ok ? { ok: true as const, summary: check.summary, verified: check.verified } : check;
}

/** Checks and, if the file is fine, creates it as a new draft course. */
export async function runImport(
  ctx: ActionCtx,
  as: ImportAs,
  text: string,
  universityId: Id<"universities"> | null | undefined,
): Promise<ImportResult> {
  const check = await checkKalami(text);
  if (!check.ok) {
    return check;
  }
  const { file, summary, verified } = check;
  const { course } = file;
  const begun: { courseId: Id<"courses">; existing: boolean } = await ctx.runMutation(internal.kalami.importBegin, {
    as,
    title: course.title,
    description: course.description,
    semester: course.semester,
    language: course.language,
    universityId: universityId ?? undefined,
    noUniversity: universityId === null,
  });
  const { courseId } = begun;
  if (begun.existing) {
    return { ok: true as const, courseId, summary, verified };
  }
  try {
    for (const week of course.weeks) {
      const weekId = await ctx.runMutation(internal.kalami.importWeek, {
        as,
        courseId,
        title: week.title,
        description: week.description,
        links: week.links,
        lessons: week.lessons,
        presentations: week.presentations,
      });
      for (const assessment of week.assessments) {
        await ctx.runMutation(internal.kalami.importAssessment, { as, courseId, weekId, assessment });
      }
    }
    for (const assessment of [...course.exams, ...course.other]) {
      await ctx.runMutation(internal.kalami.importAssessment, { as, courseId, assessment });
    }
  } catch (error) {
    await ctx.runMutation(internal.kalami.importDiscard, { as, courseId });
    throw error;
  }
  await ctx.runMutation(internal.kalami.importFinish, { as, courseId });
  return { ok: true as const, courseId, summary, verified };
}
