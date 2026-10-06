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
  v.literal("task"),
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
  v.literal("code"),
);
export type QuestionType = Infer<typeof questionTypeValidator>;

/** A choice shown to students. Which ones are correct lives in answerKeys. */
export const optionValidator = v.object({ id: v.string(), text: v.string() });

// --- Code tasks (HTML/CSS sandbox). Rules mirror lib/checks/types.ts. ----------

export const codeFileValidator = v.object({ name: v.string(), content: v.string() });
export type CodeFileDoc = Infer<typeof codeFileValidator>;

/** The same rule shapes with or without an id; agents send them without, the server numbers them. */
function checkRuleVariants<Base extends Record<string, ReturnType<typeof v.string>>>(base: Base) {
  return v.union(
    v.object({ ...base, type: v.literal("exists"), selector: v.string() }),
    v.object({ ...base, type: v.literal("not_exists"), selector: v.string() }),
    v.object({
      ...base,
      type: v.literal("count"),
      selector: v.string(),
      min: v.optional(v.number()),
      max: v.optional(v.number()),
    }),
    v.object({
      ...base,
      type: v.literal("text"),
      selector: v.string(),
      equals: v.optional(v.string()),
      contains: v.optional(v.string()),
      caseSensitive: v.optional(v.boolean()),
      every: v.optional(v.boolean()),
    }),
    v.object({
      ...base,
      type: v.literal("attr"),
      selector: v.string(),
      attribute: v.string(),
      equals: v.optional(v.string()),
      contains: v.optional(v.string()),
      every: v.optional(v.boolean()),
    }),
    v.object({
      ...base,
      type: v.literal("css"),
      selector: v.string(),
      property: v.string(),
      equals: v.optional(v.string()),
      oneOf: v.optional(v.array(v.string())),
      every: v.optional(v.boolean()),
      viewport: v.optional(v.number()),
    }),
    v.object({ ...base, type: v.literal("linked"), href: v.string() }),
  );
}

export const checkRuleValidator = checkRuleVariants({ id: v.string(), label: v.string() });
export type CheckRuleDoc = Infer<typeof checkRuleValidator>;
export const checkRuleInputValidator = checkRuleVariants({ label: v.string() });
export type CheckRuleInput = Infer<typeof checkRuleInputValidator>;

/** An image students may use by its short name, e.g. `<img src="cat.jpg">`. Hosted on ImageKit. */
export const codeAssetValidator = v.object({
  name: v.string(),
  url: v.string(),
  alt: v.optional(v.string()),
});

export const codeStepValidator = v.object({
  title: v.string(),
  /** Markdown. */
  instructions: v.string(),
  hint: v.optional(v.string()),
  /** Visible to the student, ticked live while they type. */
  checks: v.array(checkRuleValidator),
});

/**
 * A per-student variable: each student gets one of `values`, used as
 * `{{name}}` in instructions, files and checks.
 */
export const codeVariableValidator = v.object({ name: v.string(), values: v.array(v.string()) });

/** What students get with a code question: starter files and the steps, freeCodeCamp-style. */
export const codeTaskValidator = v.object({
  files: v.array(codeFileValidator),
  steps: v.array(codeStepValidator),
  assets: v.array(codeAssetValidator),
  /** Never sent to students: they get the task with their own values filled in. */
  variables: v.optional(v.array(codeVariableValidator)),
});
export type CodeTask = Infer<typeof codeTaskValidator>;

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
  v.object({
    type: v.literal("code"),
    /** Only run on submit; students never see them before. */
    hiddenChecks: v.array(checkRuleValidator),
    /** A finished version that passes every check. Proves the task can be done. */
    solution: v.array(codeFileValidator),
  }),
);
export type AnswerKey = Infer<typeof answerKeyValidator>;

/** A code task as an agent or the studio sends it. Checks get their ids on the server. */
export const codeQuestionInputValidator = v.object({
  type: v.literal("code"),
  prompt: v.string(),
  points: v.optional(v.number()),
  explanation: v.optional(v.string()),
  starterFiles: v.array(codeFileValidator),
  steps: v.array(
    v.object({
      title: v.string(),
      instructions: v.string(),
      hint: v.optional(v.string()),
      checks: v.array(checkRuleInputValidator),
    }),
  ),
  hiddenChecks: v.optional(v.array(checkRuleInputValidator)),
  solution: v.array(codeFileValidator),
  assets: v.optional(v.array(codeAssetValidator)),
  variables: v.optional(v.array(codeVariableValidator)),
});

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
  codeQuestionInputValidator,
);
export type QuestionInput = Infer<typeof questionInputValidator>;
export type CodeQuestionInput = Infer<typeof codeQuestionInputValidator>;

// --- Students taking assessments -------------------------------------------------

export const enrollmentStatusValidator = v.union(v.literal("active"), v.literal("removed"));

export const attemptStatusValidator = v.union(v.literal("in_progress"), v.literal("submitted"));
export type AttemptStatus = Infer<typeof attemptStatusValidator>;

/**
 * Integrity counters (KALAMI.md §6.2), never recordings. The first three come
 * from the editor; the rest from the page and were added later, so they're optional.
 */
export const integrityCountsValidator = v.object({
  pasteBlocked: v.number(),
  dropBlocked: v.number(),
  largeInserts: v.number(),
  tabSwitches: v.optional(v.number()),
  awayMs: v.optional(v.number()),
  fullscreenExits: v.optional(v.number()),
  copyBlocked: v.optional(v.number()),
  shortcutsBlocked: v.optional(v.number()),
  multiTab: v.optional(v.number()),
  resizes: v.optional(v.number()),
});
export type IntegrityCounts = Infer<typeof integrityCountsValidator>;

export const integrityColorValidator = v.union(v.literal("green"), v.literal("yellow"), v.literal("red"));

/** What a student saved for one question; `type` matches the question's. */
export const responseValueValidator = v.union(
  v.object({ type: v.literal("code"), files: v.array(codeFileValidator) }),
  v.object({ type: v.literal("single"), optionId: v.string() }),
  v.object({ type: v.literal("multiple"), optionIds: v.array(v.string()) }),
  v.object({ type: v.literal("short"), text: v.string() }),
  v.object({ type: v.literal("essay"), text: v.string() }),
);
export type ResponseValue = Infer<typeof responseValueValidator>;

/** A quiz answer as the student app sends it: every type except code (code saves whole files). */
export const answerValueValidator = v.union(
  v.object({ type: v.literal("single"), optionId: v.string() }),
  v.object({ type: v.literal("multiple"), optionIds: v.array(v.string()) }),
  v.object({ type: v.literal("short"), text: v.string() }),
  v.object({ type: v.literal("essay"), text: v.string() }),
);
export type AnswerValue = Infer<typeof answerValueValidator>;

export const checkOutcomeValidator = v.object({ id: v.string(), passed: v.boolean() });

// --- Notifications ---------------------------------------------------------------

/** What a notification tells a student: new work, a deadline reminder, or a message from an admin. */
export const notificationKindValidator = v.union(
  v.literal("published"),
  v.literal("due_24h"),
  v.literal("due_1h"),
  // From the admin panel's notification center: no course or work behind it.
  v.literal("announcement"),
);
export type NotificationKind = Infer<typeof notificationKindValidator>;
/** The kinds that are about a piece of work. */
export type WorkNotificationKind = Exclude<NotificationKind, "announcement">;

/**
 * Who a message from the notification center goes to. `universityId: "none"`
 * means people outside any university; absent means every university.
 */
export const broadcastAudienceValidator = v.union(
  v.object({ kind: v.literal("everyone") }),
  v.object({ kind: v.literal("students"), universityId: v.optional(v.union(v.id("universities"), v.literal("none"))) }),
  v.object({ kind: v.literal("staff"), universityId: v.optional(v.union(v.id("universities"), v.literal("none"))) }),
  v.object({ kind: v.literal("university"), universityId: v.id("universities") }),
  v.object({ kind: v.literal("group"), groupId: v.id("groups") }),
  v.object({ kind: v.literal("course"), courseId: v.id("courses") }),
  v.object({ kind: v.literal("people"), userIds: v.array(v.id("users")) }),
);
export type BroadcastAudience = Infer<typeof broadcastAudienceValidator>;

/** Besides the bell, which students always get: a push to their devices, an email. */
export const broadcastChannelsValidator = v.object({ push: v.boolean(), email: v.boolean() });
export type BroadcastChannels = Infer<typeof broadcastChannelsValidator>;

// --- Groups -----------------------------------------------------------------------

/** How a student got into a group: the group's shared link or a personal email invite. */
export const groupJoinViaValidator = v.union(v.literal("link"), v.literal("email"));
export type GroupJoinVia = Infer<typeof groupJoinViaValidator>;

// --- Course materials -------------------------------------------------------------

/** A week's materials live in a folder Kalami made in the lecturer's Google Drive, or behind a link. */
export const materialsSourceValidator = v.union(v.literal("drive"), v.literal("link"));
export type MaterialsSource = Infer<typeof materialsSourceValidator>;

export const materialsStatusValidator = v.union(v.literal("draft"), v.literal("published"));
export type MaterialsStatus = Infer<typeof materialsStatusValidator>;

// --- Messages (the contact card) ----------------------------------------------------

/** Stable topic ids; the labels live in the apps and can change freely. */
export const contactTopicValidator = v.union(
  v.literal("materials_access"),
  v.literal("missing_material"),
  v.literal("assignment"),
  v.literal("grade"),
  v.literal("submission"),
  v.literal("absence"),
  v.literal("app_problem"),
  v.literal("other"),
);
export type ContactTopic = Infer<typeof contactTopicValidator>;

/** Who a conversation goes to: one of the student's lecturers, or the Kalami team. */
export const contactRecipientValidator = v.union(v.literal("lecturer"), v.literal("admin"));
export type ContactRecipient = Infer<typeof contactRecipientValidator>;

/** open: waiting for staff. answered: staff replied last. resolved: closed by either side. */
export const conversationStatusValidator = v.union(v.literal("open"), v.literal("answered"), v.literal("resolved"));
export type ConversationStatus = Infer<typeof conversationStatusValidator>;

// --- Course outline: weeks and lessons ---------------------------------------------

/** Weeks and lessons are either still being prepared or visible to students. */
export const publishStatusValidator = v.union(v.literal("draft"), v.literal("published"));
export type PublishStatus = Infer<typeof publishStatusValidator>;

/** A link in a week's materials (OneDrive, a website, a video playlist…). */
export const weekLinkValidator = v.object({
  id: v.string(),
  title: v.string(),
  url: v.string(),
});
export type WeekLink = Infer<typeof weekLinkValidator>;

/** A quick self-check inside a lesson. Ungraded, so the answer travels with it. */
export const lessonCheckValidator = v.object({
  kind: v.union(v.literal("single"), v.literal("multiple"), v.literal("short")),
  prompt: v.string(),
  options: v.optional(v.array(v.object({ text: v.string(), correct: v.boolean() }))),
  // short: answers that count as right (compared ignoring case and spaces).
  accepted: v.optional(v.array(v.string())),
  explanation: v.optional(v.string()),
});

/**
 * A lesson is a list of blocks, so the editor and an agent can build it piece
 * by piece, and each block can get its own animation later. Text is Markdown,
 * rendered as plain React text (never HTML).
 */
export const lessonBlockValidator = v.union(
  v.object({ id: v.string(), type: v.literal("text"), md: v.string() }),
  v.object({
    id: v.string(),
    type: v.literal("callout"),
    tone: v.union(v.literal("tip"), v.literal("definition"), v.literal("warning"), v.literal("note")),
    title: v.optional(v.string()),
    md: v.string(),
  }),
  v.object({
    id: v.string(),
    type: v.literal("code"),
    language: v.string(),
    code: v.string(),
    caption: v.optional(v.string()),
    // HTML/CSS only: show the result next to the code, in the sandboxed preview.
    preview: v.optional(v.boolean()),
  }),
  v.object({ id: v.string(), type: v.literal("image"), url: v.string(), alt: v.string(), caption: v.optional(v.string()) }),
  v.object({ id: v.string(), type: v.literal("video"), url: v.string(), caption: v.optional(v.string()) }),
  v.object({
    id: v.string(),
    type: v.literal("steps"),
    title: v.optional(v.string()),
    steps: v.array(v.object({ title: v.optional(v.string()), md: v.string() })),
  }),
  v.object({ id: v.string(), type: v.literal("check"), check: lessonCheckValidator }),
);
export type LessonBlock = Infer<typeof lessonBlockValidator>;

/** A block as editors and agents send it: the id is optional (new blocks get one). */
export const lessonBlockInputValidator = v.union(
  v.object({ id: v.optional(v.string()), type: v.literal("text"), md: v.string() }),
  v.object({
    id: v.optional(v.string()),
    type: v.literal("callout"),
    tone: v.union(v.literal("tip"), v.literal("definition"), v.literal("warning"), v.literal("note")),
    title: v.optional(v.string()),
    md: v.string(),
  }),
  v.object({
    id: v.optional(v.string()),
    type: v.literal("code"),
    language: v.string(),
    code: v.string(),
    caption: v.optional(v.string()),
    preview: v.optional(v.boolean()),
  }),
  v.object({
    id: v.optional(v.string()),
    type: v.literal("image"),
    url: v.string(),
    alt: v.string(),
    caption: v.optional(v.string()),
  }),
  v.object({ id: v.optional(v.string()), type: v.literal("video"), url: v.string(), caption: v.optional(v.string()) }),
  v.object({
    id: v.optional(v.string()),
    type: v.literal("steps"),
    title: v.optional(v.string()),
    steps: v.array(v.object({ title: v.optional(v.string()), md: v.string() })),
  }),
  v.object({ id: v.optional(v.string()), type: v.literal("check"), check: lessonCheckValidator }),
);
export type LessonBlockInput = Infer<typeof lessonBlockInputValidator>;

/** A published week as students see it (model/weeks.ts publishedWeeks). */
export const studentWeekValidator = v.object({
  _id: v.id("weeks"),
  title: v.string(),
  description: v.optional(v.string()),
  links: v.array(v.object({ id: v.string(), title: v.string(), url: v.string(), host: v.string() })),
  /** The week's Drive folder, once it's shared. */
  driveUrl: v.optional(v.string()),
  lessons: v.array(v.object({ _id: v.id("lessons"), title: v.string() })),
});
