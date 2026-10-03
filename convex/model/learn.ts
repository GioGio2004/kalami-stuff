import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { requireStudent } from "../lib/auth";
import { fill, fillRule, fillTask, pickValues, runChecks, type CheckRule, type CodeFile } from "../lib/checks";
import { appError } from "../lib/errors";
import { addCounts, hasCounts, NO_COUNTS } from "../lib/integrity";
import {
  assessmentKindValidator,
  attemptStatusValidator,
  checkOutcomeValidator,
  codeAssetValidator,
  codeFileValidator,
  codeStepValidator,
  integrityLevelValidator,
  resultsVisibilityValidator,
  type CheckRuleDoc,
  type CodeTask,
  type IntegrityCounts,
} from "../lib/validators";
import { displayName } from "./audit";
import { MAX_FILE_CHARS, MAX_FILES } from "./codeTasks";

/**
 * The student side: joining courses, seeing what's open, and working on code
 * tasks. Everything goes through an active enrollment; answer keys and hidden
 * checks never leave the server before the results say so, and every student
 * gets the task with their own variant values filled in.
 */

type Student = Awaited<ReturnType<typeof requireStudent>>;

// --- Variants ------------------------------------------------------------------------

/** One student's version of a code task: their values filled in, the variable list removed. */
export function taskFor(code: CodeTask, user: Doc<"users">, assessmentId: Id<"assessments">) {
  const values = pickValues(code.variables ?? [], `${user._id}:${assessmentId}`, user);
  const { files, steps, assets } = fillTask(code, values);
  return { code: { files, steps, assets }, values };
}

export function hiddenChecksFor(hidden: CheckRuleDoc[], values: Record<string, string>): CheckRuleDoc[] {
  return hidden.map((rule) => fillRule(rule as CheckRule, values) as CheckRuleDoc);
}

// --- Enrollment ------------------------------------------------------------------------

// Wrong codes allowed per window before joining is paused. Real codes have 6 characters
// from a 30-letter alphabet, so this makes guessing pointless.
const JOIN_WINDOW_MS = 15 * 60 * 1000;
const JOIN_MAX_FAILURES = 8;

export const joinResultValidator = v.union(
  v.object({ ok: v.literal(true), courseId: v.id("courses") }),
  v.object({ ok: v.literal(false), message: v.string() }),
);

/**
 * Wrong codes return { ok: false } instead of throwing, so the failure count is
 * saved (a thrown error would roll it back).
 */
export async function joinCourse(ctx: MutationCtx, student: Student, rawCode: string) {
  const now = Date.now();
  const limit = await ctx.db
    .query("joinAttempts")
    .withIndex("by_userId", (q) => q.eq("userId", student.user._id))
    .unique();
  const fresh = limit === null || now - limit.windowStart > JOIN_WINDOW_MS;
  if (!fresh && limit.failures >= JOIN_MAX_FAILURES) {
    const minutes = Math.ceil((limit.windowStart + JOIN_WINDOW_MS - now) / 60_000);
    return {
      ok: false as const,
      message: `Too many wrong codes. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}, or ask your lecturer for the link.`,
    };
  }
  async function failed(message: string) {
    if (limit === null) {
      await ctx.db.insert("joinAttempts", { userId: student.user._id, windowStart: now, failures: 1 });
    } else if (fresh) {
      await ctx.db.patch("joinAttempts", limit._id, { windowStart: now, failures: 1 });
    } else {
      await ctx.db.patch("joinAttempts", limit._id, { failures: limit.failures + 1 });
    }
    return { ok: false as const, message };
  }

  const code = rawCode.trim().toUpperCase().replace(/[\s-]/g, "");
  if (!/^[A-Z0-9]{4,12}$/.test(code)) {
    return { ok: false as const, message: "Type the code your lecturer gave you, like K7MP4Q." };
  }
  const matches = await ctx.db
    .query("courses")
    .withIndex("by_joinCode", (q) => q.eq("joinCode", code))
    .take(5);
  // One answer for a wrong code, a draft course or joining switched off.
  const course = matches.find((c) => c.joinEnabled && c.status === "published");
  if (course === undefined) {
    return await failed("No open course has this code. Check it with your lecturer.");
  }
  if (course.universityId !== student.universityId) {
    return await failed("This course belongs to another university.");
  }
  const existing = await ctx.db
    .query("enrollments")
    .withIndex("by_courseId_and_userId", (q) => q.eq("courseId", course._id).eq("userId", student.user._id))
    .unique();
  if (existing?.status === "removed") {
    return { ok: false as const, message: "Your lecturer removed you from this course. Ask them to add you back." };
  }
  if (existing === null) {
    await ctx.db.insert("enrollments", {
      courseId: course._id,
      userId: student.user._id,
      status: "active",
      enrolledAt: now,
    });
  }
  if (limit !== null && limit.failures > 0) {
    await ctx.db.patch("joinAttempts", limit._id, { failures: 0 });
  }
  return { ok: true as const, courseId: course._id };
}

/** The course, if the student is actively enrolled and it's visible to students. NOT_FOUND otherwise. */
async function requireEnrolledCourse(ctx: QueryCtx, student: Student, courseId: Id<"courses">) {
  const course = await ctx.db.get("courses", courseId);
  const enrollment =
    course === null
      ? null
      : await ctx.db
          .query("enrollments")
          .withIndex("by_courseId_and_userId", (q) => q.eq("courseId", courseId).eq("userId", student.user._id))
          .unique();
  if (course === null || course.status === "draft" || enrollment?.status !== "active") {
    throw appError("NOT_FOUND", "Course not found.");
  }
  return course;
}

type WindowState = "upcoming" | "open" | "closed";

function windowState(assessment: Doc<"assessments">, course: Doc<"courses">, now: number): WindowState {
  const { opensAt, closesAt } = assessment.settings;
  if (opensAt !== undefined && now < opensAt) return "upcoming";
  if (course.status === "archived" || (closesAt !== undefined && now >= closesAt)) return "closed";
  return "open";
}

async function latestAttempt(ctx: QueryCtx, userId: Id<"users">, assessmentId: Id<"assessments">) {
  return await ctx.db
    .query("attempts")
    .withIndex("by_userId_and_assessmentId", (q) => q.eq("userId", userId).eq("assessmentId", assessmentId))
    .order("desc")
    .first();
}

/** What the results setting lets the student see right now. */
function visibleResults(assessment: Doc<"assessments">, state: WindowState): "none" | "score" | "full" {
  switch (assessment.settings.resultsVisibility) {
    case "hidden":
      return "none";
    case "score":
      return "score";
    case "full_after_close":
      return state === "closed" || assessment.settings.closesAt === undefined ? "full" : "none";
  }
}

/** The score that counts: the lecturer's, if they changed it. */
function finalScore(attempt: Doc<"attempts">): number | undefined {
  return attempt.manualScore ?? attempt.score;
}

// --- Courses -----------------------------------------------------------------------

export const myCourseValidator = v.object({
  _id: v.id("courses"),
  title: v.string(),
  description: v.optional(v.string()),
  semester: v.optional(v.string()),
  lecturer: v.string(),
  archived: v.boolean(),
  openCount: v.number(),
});

async function activeCourses(ctx: QueryCtx, student: Student) {
  const enrollments = await ctx.db
    .query("enrollments")
    .withIndex("by_userId", (q) => q.eq("userId", student.user._id))
    .take(100);
  const courses: Doc<"courses">[] = [];
  for (const enrollment of enrollments) {
    if (enrollment.status !== "active") continue;
    const course = await ctx.db.get("courses", enrollment.courseId);
    if (course !== null && course.status !== "draft") courses.push(course);
  }
  return courses;
}

async function publishedIn(ctx: QueryCtx, courseId: Id<"courses">) {
  return await ctx.db
    .query("assessments")
    .withIndex("by_courseId_and_status", (q) => q.eq("courseId", courseId).eq("status", "published"))
    .take(200);
}

export async function listMyCourses(ctx: QueryCtx, student: Student) {
  const now = Date.now();
  const out = [];
  for (const course of await activeCourses(ctx, student)) {
    const published = await publishedIn(ctx, course._id);
    out.push({
      _id: course._id,
      title: course.title,
      description: course.description,
      semester: course.semester,
      lecturer: displayName(await ctx.db.get("users", course.ownerId)),
      archived: course.status === "archived",
      openCount: published.filter((a) => windowState(a, course, now) === "open").length,
    });
  }
  return out;
}

export const upNextValidator = v.object({
  _id: v.id("assessments"),
  kind: assessmentKindValidator,
  title: v.string(),
  courseId: v.id("courses"),
  courseTitle: v.string(),
  closesAt: v.optional(v.number()),
  started: v.boolean(),
  playable: v.boolean(),
});

/** Open work across all the student's courses that isn't submitted yet, nearest deadline first. */
export async function listUpNext(ctx: QueryCtx, student: Student) {
  const now = Date.now();
  const out = [];
  for (const course of await activeCourses(ctx, student)) {
    for (const assessment of await publishedIn(ctx, course._id)) {
      if (windowState(assessment, course, now) !== "open") continue;
      const attempt = await latestAttempt(ctx, student.user._id, assessment._id);
      if (attempt?.status === "submitted") continue;
      out.push({
        _id: assessment._id,
        kind: assessment.kind,
        title: assessment.title,
        courseId: course._id,
        courseTitle: course.title,
        closesAt: assessment.settings.closesAt,
        started: attempt !== null,
        playable: assessment.kind === "task",
      });
    }
  }
  out.sort((a, b) => (a.closesAt ?? Infinity) - (b.closesAt ?? Infinity));
  return out.slice(0, 10);
}

const resultValidator = v.object({
  status: attemptStatusValidator,
  submittedAt: v.optional(v.number()),
  score: v.optional(v.number()),
});

export const studentCourseValidator = v.object({
  _id: v.id("courses"),
  title: v.string(),
  description: v.optional(v.string()),
  semester: v.optional(v.string()),
  lecturer: v.string(),
  archived: v.boolean(),
  assessments: v.array(
    v.object({
      _id: v.id("assessments"),
      kind: assessmentKindValidator,
      title: v.string(),
      state: v.union(v.literal("upcoming"), v.literal("open"), v.literal("closed")),
      opensAt: v.optional(v.number()),
      closesAt: v.optional(v.number()),
      totalPoints: v.number(),
      questionCount: v.number(),
      /** Whether the student app can run it yet (code tasks for now). */
      playable: v.boolean(),
      result: v.union(v.null(), resultValidator),
    }),
  ),
});

export async function getStudentCourse(ctx: QueryCtx, student: Student, courseId: Id<"courses">) {
  const course = await requireEnrolledCourse(ctx, student, courseId);
  const now = Date.now();
  const published = await publishedIn(ctx, course._id);
  published.sort((a, b) => (a.publishedAt ?? 0) - (b.publishedAt ?? 0));
  const assessments = [];
  for (const assessment of published) {
    const state = windowState(assessment, course, now);
    const attempt = await latestAttempt(ctx, student.user._id, assessment._id);
    const results = visibleResults(assessment, state);
    assessments.push({
      _id: assessment._id,
      kind: assessment.kind,
      title: assessment.title,
      state,
      opensAt: assessment.settings.opensAt,
      closesAt: assessment.settings.closesAt,
      totalPoints: assessment.totalPoints,
      questionCount: assessment.questionCount,
      playable: assessment.kind === "task",
      result:
        attempt === null
          ? null
          : {
              status: attempt.status,
              submittedAt: attempt.submittedAt,
              score: results !== "none" ? finalScore(attempt) : undefined,
            },
    });
  }
  return {
    _id: course._id,
    title: course.title,
    description: course.description,
    semester: course.semester,
    lecturer: displayName(await ctx.db.get("users", course.ownerId)),
    archived: course.status === "archived",
    assessments,
  };
}

// --- Code tasks ----------------------------------------------------------------------

const commentValidator = v.object({
  _id: v.id("codeComments"),
  questionId: v.id("questions"),
  file: v.string(),
  line: v.number(),
  text: v.string(),
  author: v.string(),
});

export const studentTaskValidator = v.object({
  course: v.object({ _id: v.id("courses"), title: v.string() }),
  assessment: v.object({
    _id: v.id("assessments"),
    title: v.string(),
    instructions: v.optional(v.string()),
    state: v.union(v.literal("open"), v.literal("closed")),
    closesAt: v.optional(v.number()),
    integrityLevel: integrityLevelValidator,
    resultsVisibility: resultsVisibilityValidator,
    totalPoints: v.number(),
  }),
  questions: v.array(
    v.object({
      _id: v.id("questions"),
      prompt: v.string(),
      points: v.number(),
      // The student's own version: no variable list, their values filled in.
      code: v.object({
        files: v.array(codeFileValidator),
        steps: v.array(codeStepValidator),
        assets: v.array(codeAssetValidator),
      }),
    }),
  ),
  attempt: v.union(
    v.null(),
    v.object({
      status: attemptStatusValidator,
      startedAt: v.number(),
      submittedAt: v.optional(v.number()),
      autoSubmitted: v.boolean(),
      score: v.optional(v.number()),
      maxScore: v.number(),
      feedback: v.optional(v.string()),
    }),
  ),
  responses: v.array(
    v.object({
      questionId: v.id("questions"),
      files: v.array(v.object({ name: v.string(), content: v.string() })),
      savedAt: v.number(),
      progress: v.optional(v.object({ step: v.number(), passed: v.array(v.string()) })),
      checkResults: v.optional(v.array(checkOutcomeValidator)),
      autoScore: v.optional(v.number()),
    }),
  ),
  /** Labels of the hidden checks, only once full results are visible. */
  hiddenChecks: v.array(v.object({ questionId: v.id("questions"), id: v.string(), label: v.string() })),
  /** The lecturer's red-pen notes, once the work is submitted. */
  comments: v.array(commentValidator),
  /** Questions this player can't show yet (not code). */
  unsupported: v.number(),
});

async function requireOpenableAssessment(ctx: QueryCtx, student: Student, assessmentId: Id<"assessments">) {
  const assessment = await ctx.db.get("assessments", assessmentId);
  if (assessment === null || assessment.status !== "published") {
    throw appError("NOT_FOUND", "Task not found.");
  }
  const course = await requireEnrolledCourse(ctx, student, assessment.courseId);
  const state = windowState(assessment, course, Date.now());
  if (state === "upcoming") {
    throw appError("CONFLICT", "This task hasn't opened yet.");
  }
  return { assessment, course, state };
}

async function questionsOf(ctx: QueryCtx, assessmentId: Id<"assessments">) {
  return await ctx.db
    .query("questions")
    .withIndex("by_assessmentId_and_order", (q) => q.eq("assessmentId", assessmentId))
    .take(200);
}

async function responseFor(ctx: QueryCtx, attemptId: Id<"attempts">, questionId: Id<"questions">) {
  return await ctx.db
    .query("responses")
    .withIndex("by_attemptId_and_questionId", (q) => q.eq("attemptId", attemptId).eq("questionId", questionId))
    .unique();
}

async function keyFor(ctx: QueryCtx, questionId: Id<"questions">) {
  const row = await ctx.db
    .query("answerKeys")
    .withIndex("by_questionId", (q) => q.eq("questionId", questionId))
    .unique();
  return row?.key.type === "code" ? row.key : null;
}

export async function listComments(ctx: QueryCtx, attemptId: Id<"attempts">) {
  const rows = await ctx.db
    .query("codeComments")
    .withIndex("by_attemptId", (q) => q.eq("attemptId", attemptId))
    .take(500);
  const names = new Map<Id<"users">, string>();
  const out = [];
  for (const row of rows) {
    if (!names.has(row.authorId)) names.set(row.authorId, displayName(await ctx.db.get("users", row.authorId)));
    out.push({
      _id: row._id,
      questionId: row.questionId,
      file: row.file,
      line: row.line,
      text: row.text,
      author: names.get(row.authorId)!,
    });
  }
  return out;
}

export async function getStudentTask(ctx: QueryCtx, student: Student, assessmentId: Id<"assessments">) {
  const { assessment, course, state } = await requireOpenableAssessment(ctx, student, assessmentId);
  const all = await questionsOf(ctx, assessmentId);
  const questions = [];
  const valuesByQuestion = new Map<Id<"questions">, Record<string, string>>();
  for (const q of all) {
    if (q.type !== "code" || q.code === undefined) continue;
    const { code, values } = taskFor(q.code, student.user, assessmentId);
    valuesByQuestion.set(q._id, values);
    questions.push({ _id: q._id, prompt: fill(q.prompt, values), points: q.points, code });
  }
  const attempt = await latestAttempt(ctx, student.user._id, assessmentId);
  const submitted = attempt?.status === "submitted";
  const results = submitted ? visibleResults(assessment, state) : "none";
  const responses = [];
  const hiddenChecks = [];
  if (attempt !== null) {
    for (const question of questions) {
      const response = await responseFor(ctx, attempt._id, question._id);
      if (response === null) continue;
      responses.push({
        questionId: question._id,
        files: response.value.files,
        savedAt: response.savedAt,
        progress: response.progress,
        // Visible checks the student saw anyway; hidden ones only with full results.
        checkResults:
          results === "full"
            ? response.checkResults
            : results === "score"
              ? response.checkResults?.filter((r) => !r.id.startsWith("h"))
              : undefined,
        autoScore: results !== "none" ? response.autoScore : undefined,
      });
      if (results === "full") {
        const key = await keyFor(ctx, question._id);
        const values = valuesByQuestion.get(question._id) ?? {};
        for (const rule of hiddenChecksFor(key?.hiddenChecks ?? [], values)) {
          hiddenChecks.push({ questionId: question._id, id: rule.id, label: rule.label });
        }
      }
    }
  }
  return {
    course: { _id: course._id, title: course.title },
    assessment: {
      _id: assessment._id,
      title: assessment.title,
      instructions: assessment.instructions,
      state: state === "closed" ? ("closed" as const) : ("open" as const),
      closesAt: assessment.settings.closesAt,
      integrityLevel: assessment.settings.integrityLevel,
      resultsVisibility: assessment.settings.resultsVisibility,
      totalPoints: assessment.totalPoints,
    },
    questions,
    attempt:
      attempt === null
        ? null
        : {
            status: attempt.status,
            startedAt: attempt.startedAt,
            submittedAt: attempt.submittedAt,
            autoSubmitted: attempt.autoSubmitted ?? false,
            score: results !== "none" ? finalScore(attempt) : undefined,
            maxScore: attempt.maxScore,
            feedback: submitted ? attempt.feedback : undefined,
          },
    responses,
    hiddenChecks,
    comments: submitted && attempt !== null ? await listComments(ctx, attempt._id) : [],
    unsupported: all.length - questions.length,
  };
}

/** The student's files, limited to the task's own files and filled in from the starter. */
function cleanFiles(code: { files: CodeFile[] }, files: CodeFile[]): CodeFile[] {
  if (files.length > MAX_FILES) {
    throw appError("INVALID_INPUT", "Too many files.");
  }
  const sent = new Map(files.map((f) => [f.name, f.content]));
  return code.files.map((starter) => {
    const content = sent.get(starter.name) ?? starter.content;
    if (content.length > MAX_FILE_CHARS) {
      throw appError("INVALID_INPUT", `${starter.name} is longer than ${MAX_FILE_CHARS} characters.`);
    }
    return { name: starter.name, content };
  });
}

/** First step with a failing visible check, and the visible checks that pass. */
export function stepProgress(code: { steps: { checks: CheckRuleDoc[] }[] }, files: CodeFile[]) {
  const rules = code.steps.flatMap((step) => step.checks) as CheckRule[];
  const results = new Map(runChecks(files, rules).map((r) => [r.id, r.passed]));
  const firstFailing = code.steps.findIndex((step) => step.checks.some((c) => !results.get(c.id)));
  return {
    step: firstFailing === -1 ? code.steps.length : firstFailing,
    passed: rules.filter((r) => results.get(r.id)).map((r) => r.id),
  };
}

/** The student's in-progress attempt, started now if they have none. Refuses closed or submitted work. */
async function ensureAttempt(ctx: MutationCtx, student: Student, assessmentId: Id<"assessments">) {
  const { assessment, state } = await requireOpenableAssessment(ctx, student, assessmentId);
  if (state === "closed") {
    throw appError("CONFLICT", "This task is closed, so changes can't be saved.");
  }
  const attempt = await latestAttempt(ctx, student.user._id, assessment._id);
  if (attempt?.status === "submitted") {
    throw appError("CONFLICT", "You already submitted this task.");
  }
  if (attempt !== null) {
    return { assessment, attempt };
  }
  const attemptId = await ctx.db.insert("attempts", {
    assessmentId: assessment._id,
    courseId: assessment.courseId,
    userId: student.user._id,
    number: 1,
    status: "in_progress",
    startedAt: Date.now(),
    maxScore: assessment.totalPoints,
    integrity: NO_COUNTS,
  });
  return { assessment, attempt: (await ctx.db.get("attempts", attemptId))! };
}

export async function saveCode(
  ctx: MutationCtx,
  student: Student,
  args: {
    assessmentId: Id<"assessments">;
    questionId: Id<"questions">;
    files: CodeFile[];
    integrity?: Partial<IntegrityCounts>;
  },
) {
  const { assessment, attempt } = await ensureAttempt(ctx, student, args.assessmentId);
  const question = await ctx.db.get("questions", args.questionId);
  if (question === null || question.assessmentId !== assessment._id || question.code === undefined) {
    throw appError("NOT_FOUND", "Question not found.");
  }
  const { code } = taskFor(question.code, student.user, assessment._id);
  const files = cleanFiles(code, args.files);
  if (hasCounts(args.integrity)) {
    await ctx.db.patch("attempts", attempt._id, { integrity: addCounts(attempt.integrity, args.integrity!) });
  }
  const now = Date.now();
  const progress = stepProgress(code, files);
  const existing = await responseFor(ctx, attempt._id, question._id);
  const value = { type: "code" as const, files };
  if (existing === null) {
    await ctx.db.insert("responses", {
      attemptId: attempt._id,
      questionId: question._id,
      userId: student.user._id,
      value,
      progress,
      savedAt: now,
    });
  } else {
    await ctx.db.patch("responses", existing._id, { value, progress, savedAt: now });
  }
  return { savedAt: now, progress };
}

/** Counters from the page (tab switches, fullscreen…), sent every few seconds while they change. */
export async function reportIntegrity(
  ctx: MutationCtx,
  student: Student,
  assessmentId: Id<"assessments">,
  counts: Partial<IntegrityCounts>,
) {
  if (!hasCounts(counts)) return null;
  const { attempt } = await ensureAttempt(ctx, student, assessmentId);
  await ctx.db.patch("attempts", attempt._id, { integrity: addCounts(attempt.integrity, counts) });
  return null;
}

/**
 * Grades every code question with all of its checks (hidden ones included, the
 * student's own variant) and closes the attempt. Used on submit and when a task closes.
 */
export async function gradeAttempt(ctx: MutationCtx, attempt: Doc<"attempts">, options: { auto: boolean }) {
  const user = await ctx.db.get("users", attempt.userId);
  if (user === null) return;
  let score = 0;
  for (const question of await questionsOf(ctx, attempt.assessmentId)) {
    if (question.type !== "code" || question.code === undefined) continue;
    const { code, values } = taskFor(question.code, user, attempt.assessmentId);
    const key = await keyFor(ctx, question._id);
    const rules = [...code.steps.flatMap((s) => s.checks), ...hiddenChecksFor(key?.hiddenChecks ?? [], values)];
    const response = await responseFor(ctx, attempt._id, question._id);
    const files = response?.value.files ?? code.files;
    const checkResults = runChecks(files, rules as CheckRule[]).map((r) => ({ id: r.id, passed: r.passed }));
    const passed = checkResults.filter((r) => r.passed).length;
    const autoScore = rules.length === 0 ? 0 : Math.round((question.points * passed * 100) / rules.length) / 100;
    score += autoScore;
    if (response === null) {
      await ctx.db.insert("responses", {
        attemptId: attempt._id,
        questionId: question._id,
        userId: attempt.userId,
        value: { type: "code", files },
        progress: stepProgress(code, files),
        savedAt: Date.now(),
        checkResults,
        autoScore,
      });
    } else {
      await ctx.db.patch("responses", response._id, { checkResults, autoScore });
    }
  }
  await ctx.db.patch("attempts", attempt._id, {
    status: "submitted",
    submittedAt: Date.now(),
    score: Math.round(score * 100) / 100,
    autoSubmitted: options.auto ? true : undefined,
  });
}

export async function submitTask(ctx: MutationCtx, student: Student, assessmentId: Id<"assessments">) {
  const { assessment } = await requireOpenableAssessment(ctx, student, assessmentId);
  const attempt = await latestAttempt(ctx, student.user._id, assessment._id);
  if (attempt === null) {
    throw appError("CONFLICT", "Write some code before submitting.");
  }
  if (attempt.status === "submitted") {
    throw appError("CONFLICT", "You already submitted this task.");
  }
  await gradeAttempt(ctx, attempt, { auto: false });
  return null;
}

/** Cron: grade the work of everyone still in progress on a task that has closed. */
export async function autoSubmitClosed(ctx: MutationCtx): Promise<number> {
  const now = Date.now();
  const open = await ctx.db
    .query("attempts")
    .withIndex("by_status", (q) => q.eq("status", "in_progress"))
    .take(200);
  let submitted = 0;
  const closedCache = new Map<Id<"assessments">, boolean>();
  for (const attempt of open) {
    let closed = closedCache.get(attempt.assessmentId);
    if (closed === undefined) {
      const assessment = await ctx.db.get("assessments", attempt.assessmentId);
      const closesAt = assessment?.settings.closesAt;
      closed = assessment !== null && closesAt !== undefined && closesAt <= now;
      closedCache.set(attempt.assessmentId, closed);
    }
    // Keep each run small; the next minute picks up the rest.
    if (closed && submitted < 50) {
      await gradeAttempt(ctx, attempt, { auto: true });
      submitted++;
    }
  }
  return submitted;
}
