import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  answerKeyValidator,
  attemptStatusValidator,
  checkOutcomeValidator,
  codeTaskValidator,
  integrityCountsValidator,
  enrollmentStatusValidator,
  responseValueValidator,
  assessmentKindValidator,
  assessmentSettingsValidator,
  assessmentStatusValidator,
  courseStaffRoleValidator,
  courseStatusValidator,
  inviteRoleValidator,
  localeValidator,
  localizedTextValidator,
  notificationKindValidator,
  optionValidator,
  questionTypeValidator,
  roleValidator,
  universityStatusValidator,
  viaValidator,
} from "./lib/validators";

export default defineSchema({
  universities: defineTable({
    name: localizedTextValidator,
    slug: v.string(),
    status: universityStatusValidator,
  })
    .index("by_slug", ["slug"])
    .index("by_status", ["status"]),

  users: defineTable({
    // Clerk identity (`issuer|subject`). The key signed-in requests are matched by.
    tokenIdentifier: v.string(),
    // Clerk user id (`user_…`), the key Clerk webhooks refer to. Optional only for
    // rows created before webhooks existed; ensureUser fills it in.
    clerkUserId: v.optional(v.string()),
    // Lowercased, copied from the verified session token on every sign-in.
    email: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    locale: localeValidator,
    honestyAcceptedAt: v.optional(v.number()),
    honestyVersion: v.optional(v.number()),
    // Staff only: when they dismissed the studio's "how this works" card.
    studioIntroSeenAt: v.optional(v.number()),
  })
    .index("by_tokenIdentifier", ["tokenIdentifier"])
    .index("by_clerkUserId", ["clerkUserId"])
    .index("by_email", ["email"]),

  // Roles live here, not in Clerk: one row per (user, university, role).
  memberships: defineTable({
    userId: v.id("users"),
    // Absent only for super_admin, which spans every university.
    universityId: v.optional(v.id("universities")),
    role: roleValidator,
    // Student profile, filled in during onboarding.
    faculty: v.optional(v.string()),
    group: v.optional(v.string()),
    year: v.optional(v.number()),
    studentNumber: v.optional(v.string()),
  })
    .index("by_userId", ["userId"])
    .index("by_universityId_and_role", ["universityId", "role"]),

  invites: defineTable({
    // Lowercased. Only a signed-in user with this exact email can accept.
    email: v.string(),
    universityId: v.id("universities"),
    role: inviteRoleValidator,
    token: v.string(),
    invitedBy: v.id("users"),
    expiresAt: v.number(),
    acceptedAt: v.optional(v.number()),
    acceptedBy: v.optional(v.id("users")),
    revokedAt: v.optional(v.number()),
  })
    .index("by_token", ["token"])
    .index("by_email", ["email"])
    .index("by_universityId", ["universityId"]),

  // -------------------------------------------------------------------------
  // Studio
  // -------------------------------------------------------------------------

  // The container quizzes and exams hang off. Lecture content (modules,
  // lessons) comes later and will reference courses too.
  courses: defineTable({
    universityId: v.id("universities"),
    ownerId: v.id("users"),
    title: v.string(),
    description: v.optional(v.string()),
    semester: v.optional(v.string()),
    locale: localeValidator,
    status: courseStatusValidator,
    // Short code students type to enrol (student app, later). Unique while enabled.
    joinCode: v.string(),
    joinEnabled: v.boolean(),
    createdVia: viaValidator,
    updatedAt: v.number(),
  })
    .index("by_universityId", ["universityId"])
    .index("by_ownerId", ["ownerId"])
    .index("by_joinCode", ["joinCode"]),

  // Who may work on a course besides university admins and the super admin.
  courseStaff: defineTable({
    courseId: v.id("courses"),
    userId: v.id("users"),
    role: courseStaffRoleValidator,
  })
    .index("by_courseId", ["courseId"])
    .index("by_userId", ["userId"])
    .index("by_courseId_and_userId", ["courseId", "userId"]),

  assessments: defineTable({
    courseId: v.id("courses"),
    kind: assessmentKindValidator,
    title: v.string(),
    instructions: v.optional(v.string()),
    status: assessmentStatusValidator,
    settings: assessmentSettingsValidator,
    // Kept in step with the questions table by every question mutation.
    questionCount: v.number(),
    totalPoints: v.number(),
    createdBy: v.id("users"),
    createdVia: viaValidator,
    publishedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_courseId", ["courseId"])
    .index("by_courseId_and_status", ["courseId", "status"])
    // The auto-submit cron finds what closed recently without scanning everything.
    .index("by_status_and_closesAt", ["status", "settings.closesAt"]),

  questions: defineTable({
    assessmentId: v.id("assessments"),
    // Denormalised so access checks don't need the assessment row.
    courseId: v.id("courses"),
    order: v.number(),
    type: questionTypeValidator,
    prompt: v.string(),
    points: v.number(),
    // Only for single/multiple choice.
    options: v.optional(v.array(optionValidator)),
    // Shown with full results after the assessment closes.
    explanation: v.optional(v.string()),
    // Only for code questions: starter files, steps with their visible checks, images.
    code: v.optional(codeTaskValidator),
    createdVia: viaValidator,
  }).index("by_assessmentId_and_order", ["assessmentId", "order"]),

  // Never returned to students. One row per question.
  answerKeys: defineTable({
    questionId: v.id("questions"),
    assessmentId: v.id("assessments"),
    key: answerKeyValidator,
  })
    .index("by_questionId", ["questionId"])
    .index("by_assessmentId", ["assessmentId"]),

  // -------------------------------------------------------------------------
  // Students
  // -------------------------------------------------------------------------

  // A student in a course, after typing its join code.
  enrollments: defineTable({
    courseId: v.id("courses"),
    userId: v.id("users"),
    status: enrollmentStatusValidator,
    enrolledAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_courseId", ["courseId"])
    .index("by_courseId_and_userId", ["courseId", "userId"]),

  // One student working on one assessment. Created on the first save.
  attempts: defineTable({
    assessmentId: v.id("assessments"),
    courseId: v.id("courses"),
    userId: v.id("users"),
    number: v.number(),
    status: attemptStatusValidator,
    startedAt: v.number(),
    // Timed quizzes and exams: start + time limit. Answers after it are refused. The
    // closing time is checked separately, so a lecturer can still move it.
    deadlineAt: v.optional(v.number()),
    submittedAt: v.optional(v.number()),
    score: v.optional(v.number()),
    maxScore: v.number(),
    integrity: integrityCountsValidator,
    // Progress for the lecturer's list, kept here so it never has to read answers:
    // questions answered (not code) and code steps done. Written only when they change.
    answered: v.optional(v.number()),
    stepsDone: v.optional(v.number()),
    // An essay has an answer and no points yet.
    needsGrading: v.optional(v.boolean()),
    // Submitted by the server when the task closed, not by the student.
    autoSubmitted: v.optional(v.boolean()),
    // Grading: the lecturer's overall note and, if they change it, the score that counts.
    feedback: v.optional(v.string()),
    manualScore: v.optional(v.number()),
    gradedAt: v.optional(v.number()),
    gradedBy: v.optional(v.id("users")),
  })
    .index("by_userId_and_assessmentId", ["userId", "assessmentId"])
    .index("by_assessmentId", ["assessmentId"])
    .index("by_assessmentId_and_status", ["assessmentId", "status"])
    .index("by_status_and_deadlineAt", ["status", "deadlineAt"]),

  // What a student saved for one question of an attempt (autosaved while they work).
  responses: defineTable({
    attemptId: v.id("attempts"),
    questionId: v.id("questions"),
    userId: v.id("users"),
    value: responseValueValidator,
    // Code: the first step with a failing check, and the visible checks that pass.
    progress: v.optional(v.object({ step: v.number(), passed: v.array(v.string()) })),
    savedAt: v.number(),
    // Written by the server on submit, from every check including hidden ones.
    checkResults: v.optional(v.array(checkOutcomeValidator)),
    // Points the server gave on submit. Essays have none until a lecturer grades them.
    autoScore: v.optional(v.number()),
    // Points a lecturer gave this answer; they replace autoScore.
    manualPoints: v.optional(v.number()),
  }).index("by_attemptId_and_questionId", ["attemptId", "questionId"]),

  // Red-pen notes a lecturer leaves on a line of a student's code.
  codeComments: defineTable({
    attemptId: v.id("attempts"),
    questionId: v.id("questions"),
    file: v.string(),
    line: v.number(),
    text: v.string(),
    authorId: v.id("users"),
    createdAt: v.number(),
  }).index("by_attemptId", ["attemptId"]),

  // Wrong join codes per student, so codes can't be guessed by trying many.
  joinAttempts: defineTable({
    userId: v.id("users"),
    windowStart: v.number(),
    failures: v.number(),
  }).index("by_userId", ["userId"]),

  // -------------------------------------------------------------------------
  // Notifications
  // -------------------------------------------------------------------------

  // A student's inbox: one row per event per enrolled student. The bell counts
  // the unread ones; push and email deliver the same rows.
  notifications: defineTable({
    userId: v.id("users"),
    kind: notificationKindValidator,
    courseId: v.id("courses"),
    assessmentId: v.id("assessments"),
    assessmentKind: assessmentKindValidator,
    // Copied here so a row reads on its own, in the bell, a push or an email.
    title: v.string(),
    courseTitle: v.string(),
    // The closing time, shown as "due …" in the student's own time zone.
    dueAt: v.optional(v.number()),
    // Where tapping it goes, as a path in the student app.
    href: v.string(),
    readAt: v.optional(v.number()),
  })
    .index("by_userId", ["userId"])
    .index("by_userId_and_readAt", ["userId", "readAt"]),

  // One row per (assessment, kind) once its notifications went out, so a cron
  // run or a second publish never sends them twice.
  notificationRuns: defineTable({
    assessmentId: v.id("assessments"),
    kind: notificationKindValidator,
    at: v.number(),
    // Students told so far; the fan-out adds to it batch by batch.
    sent: v.number(),
  }).index("by_assessmentId_and_kind", ["assessmentId", "kind"]),

  // Who changed what, and whether a person or their agent did it.
  auditLog: defineTable({
    actorId: v.id("users"),
    via: viaValidator,
    action: v.string(),
    targetTable: v.string(),
    targetId: v.string(),
    // The course the change belongs to, so a course page can show its history.
    courseId: v.optional(v.id("courses")),
    summary: v.string(),
    at: v.number(),
  })
    .index("by_courseId", ["courseId"])
    .index("by_actorId", ["actorId"]),
});
