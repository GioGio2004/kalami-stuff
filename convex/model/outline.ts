import { v } from "convex/values";
import { deckThemeValidator, publishStatusValidator, weekLinkValidator } from "../lib/validators";
import { assessmentValidator } from "./assessments";

// The course outline as the staff app and agents see it (model/weeks.ts getOutline).
// Kept apart from model/weeks.ts so the model can be imported anywhere without
// pulling the assessment validators into an import cycle.

const outlineLessonValidator = v.object({
  _id: v.id("lessons"),
  title: v.string(),
  status: publishStatusValidator,
  blockCount: v.number(),
  createdVia: v.union(v.literal("web"), v.literal("mcp")),
  updatedAt: v.number(),
});

const outlinePresentationValidator = v.object({
  _id: v.id("presentations"),
  title: v.string(),
  status: publishStatusValidator,
  theme: deckThemeValidator,
  slideCount: v.number(),
  /** It has a public link (the editor's Share). */
  shared: v.boolean(),
  createdVia: v.union(v.literal("web"), v.literal("mcp")),
  updatedAt: v.number(),
});

export const outlineWeekValidator = v.object({
  _id: v.id("weeks"),
  order: v.number(),
  title: v.string(),
  description: v.optional(v.string()),
  status: publishStatusValidator,
  publishedAt: v.optional(v.number()),
  links: v.array(weekLinkValidator),
  drive: v.union(
    v.null(),
    v.object({
      /** The folder, once it exists. */
      url: v.optional(v.string()),
      /** Students can open it right now. */
      shared: v.boolean(),
      syncing: v.optional(v.union(v.literal("folder"), v.literal("share"), v.literal("unshare"))),
      /** The job above stopped reporting back and may be retried. */
      stale: v.boolean(),
      error: v.optional(v.string()),
    }),
  ),
  lessons: v.array(outlineLessonValidator),
  presentations: v.array(outlinePresentationValidator),
  assessments: v.array(assessmentValidator),
});

export const outlineValidator = v.object({
  courseId: v.id("courses"),
  canEdit: v.boolean(),
  /** Whether this Kalami server can talk to Google Drive at all. */
  driveAvailable: v.boolean(),
  drive: v.union(
    v.null(),
    v.object({
      ownerName: v.string(),
      /** Only the owner's Google account is ever used for this course. */
      mine: v.boolean(),
      /** The owner left (or the viewer is the super admin): the viewer may move it to their own Drive. */
      canTakeOver: v.boolean(),
      folderUrl: v.optional(v.string()),
    }),
  ),
  weeks: v.array(outlineWeekValidator),
  /** Midterms and finals. */
  exams: v.array(assessmentValidator),
  /** Tasks and quizzes not placed in a week yet. */
  unplaced: v.array(assessmentValidator),
});
