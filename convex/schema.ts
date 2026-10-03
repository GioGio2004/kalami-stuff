import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  answerKeyValidator,
  assessmentKindValidator,
  assessmentSettingsValidator,
  assessmentStatusValidator,
  courseStaffRoleValidator,
  courseStatusValidator,
  inviteRoleValidator,
  localeValidator,
  localizedTextValidator,
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
    .index("by_courseId_and_status", ["courseId", "status"]),

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

  // Personal access tokens for the MCP connector. Only the SHA-256 of a token is
  // stored; the token itself is shown once when created.
  mcpTokens: defineTable({
    userId: v.id("users"),
    name: v.string(),
    tokenHash: v.string(),
    // The first characters of the token, so people can tell their tokens apart.
    prefix: v.string(),
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index("by_userId", ["userId"])
    // revokedAt === undefined selects a user's active tokens.
    .index("by_userId_and_revokedAt", ["userId", "revokedAt"])
    .index("by_tokenHash", ["tokenHash"]),

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
