import { v, type Infer } from "convex/values";

export const localeValidator = v.union(v.literal("ka"), v.literal("en"));
export type Locale = Infer<typeof localeValidator>;

export const roleValidator = v.union(
  v.literal("student"),
  v.literal("lecturer"),
  v.literal("uni_admin"),
  v.literal("super_admin"),
);
export type Role = Infer<typeof roleValidator>;

/** Roles that can be handed out with an email invite. */
export const inviteRoleValidator = v.union(
  v.literal("lecturer"),
  v.literal("uni_admin"),
);

export const localizedTextValidator = v.object({ ka: v.string(), en: v.string() });

export const universityStatusValidator = v.union(
  v.literal("active"),
  v.literal("archived"),
);

// ---------------------------------------------------------------------------
// Studio: courses, assessments, questions
// ---------------------------------------------------------------------------

/** Who did it: a person in the staff app, or their AI agent through the MCP connector. */
export const viaValidator = v.union(v.literal("web"), v.literal("mcp"));
export type Via = Infer<typeof viaValidator>;

export const courseStatusValidator = v.union(
  v.literal("draft"),
  v.literal("published"),
  v.literal("archived"),
);
export type CourseStatus = Infer<typeof courseStatusValidator>;

/** Per-course staff roles. The course owner edits; assistants grade and monitor (later). */
export const courseStaffRoleValidator = v.union(v.literal("owner"), v.literal("assistant"));
export type CourseStaffRole = Infer<typeof courseStaffRoleValidator>;

export const assessmentKindValidator = v.union(
  v.literal("quiz"),
  v.literal("midterm"),
  v.literal("final"),
);
export type AssessmentKind = Infer<typeof assessmentKindValidator>;

export const assessmentStatusValidator = v.union(
  v.literal("draft"),
  v.literal("published"),
  v.literal("archived"),
);
export type AssessmentStatus = Infer<typeof assessmentStatusValidator>;

export const integrityLevelValidator = v.union(
  v.literal("off"),
  v.literal("standard"),
  v.literal("strict"),
);
export type IntegrityLevel = Infer<typeof integrityLevelValidator>;

export const resultsVisibilityValidator = v.union(
  v.literal("hidden"),
  v.literal("score"),
  v.literal("full_after_close"),
);
export type ResultsVisibility = Infer<typeof resultsVisibilityValidator>;

/** The settings a lecturer (or their agent) can change on an assessment. */
export const assessmentSettingsValidator = v.object({
  opensAt: v.optional(v.number()),
  closesAt: v.optional(v.number()),
  timeLimitMin: v.optional(v.number()),
  attemptsAllowed: v.number(),
  shuffleQuestions: v.boolean(),
  shuffleOptions: v.boolean(),
  integrityLevel: integrityLevelValidator,
  resultsVisibility: resultsVisibilityValidator,
});
export type AssessmentSettings = Infer<typeof assessmentSettingsValidator>;

export const questionTypeValidator = v.union(
  v.literal("single"),
  v.literal("multiple"),
  v.literal("short"),
  v.literal("essay"),
);
export type QuestionType = Infer<typeof questionTypeValidator>;

/** A choice shown to students. Which ones are correct lives in answerKeys. */
export const optionValidator = v.object({ id: v.string(), text: v.string() });

/** Stored separately from the question so student-facing queries can never leak it. */
export const answerKeyValidator = v.union(
  v.object({ type: v.literal("single"), correctOptionId: v.string() }),
  v.object({ type: v.literal("multiple"), correctOptionIds: v.array(v.string()) }),
  v.object({
    type: v.literal("short"),
    acceptedAnswers: v.array(v.string()),
    caseSensitive: v.boolean(),
  }),
  v.object({ type: v.literal("essay"), rubric: v.optional(v.string()) }),
);
export type AnswerKey = Infer<typeof answerKeyValidator>;

/**
 * How a question arrives from the builder or an agent: options carry their own
 * `correct` flag, which the server moves into the answer key.
 */
export const questionInputValidator = v.union(
  v.object({
    type: v.literal("single"),
    prompt: v.string(),
    points: v.optional(v.number()),
    explanation: v.optional(v.string()),
    options: v.array(v.object({ text: v.string(), correct: v.boolean() })),
  }),
  v.object({
    type: v.literal("multiple"),
    prompt: v.string(),
    points: v.optional(v.number()),
    explanation: v.optional(v.string()),
    options: v.array(v.object({ text: v.string(), correct: v.boolean() })),
  }),
  v.object({
    type: v.literal("short"),
    prompt: v.string(),
    points: v.optional(v.number()),
    explanation: v.optional(v.string()),
    acceptedAnswers: v.array(v.string()),
    caseSensitive: v.optional(v.boolean()),
  }),
  v.object({
    type: v.literal("essay"),
    prompt: v.string(),
    points: v.optional(v.number()),
    explanation: v.optional(v.string()),
    rubric: v.optional(v.string()),
  }),
);
export type QuestionInput = Infer<typeof questionInputValidator>;
