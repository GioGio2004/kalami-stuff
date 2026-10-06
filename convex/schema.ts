import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  answerKeyValidator,
  attemptStatusValidator,
  checkOutcomeValidator,
  codeTaskValidator,
  contactRecipientValidator,
  contactTopicValidator,
  conversationStatusValidator,
  integrityCountsValidator,
  enrollmentStatusValidator,
  groupJoinViaValidator,
  materialsSourceValidator,
  materialsStatusValidator,
  responseValueValidator,
  assessmentKindValidator,
  assessmentSettingsValidator,
  assessmentStatusValidator,
  courseStaffRoleValidator,
  courseStatusValidator,
  inviteRoleValidator,
  lessonBlockValidator,
  deckThemeValidator,
  slideValidator,
  publishStatusValidator,
  weekLinkValidator,
  localeValidator,
  localizedTextValidator,
  notificationKindValidator,
  optionValidator,
  questionTypeValidator,
  roleValidator,
  universityStatusValidator,
  viaValidator,
  broadcastAudienceValidator,
  broadcastChannelsValidator,
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
    // Notification emails: switched off by the person (bell panel or the link in
    // an email), or stopped by Resend telling us the address bounced or complained.
    emailOptOut: v.optional(v.boolean()),
    emailStatus: v.optional(v.union(v.literal("bounced"), v.literal("complained"))),
    // Set when Clerk deleted the account: the row stays, anonymised, so grades and
    // history keep their references.
    deletedAt: v.optional(v.number()),
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
    .index("by_universityId_and_role", ["universityId", "role"])
    // The admin panel: everyone with a role across universities (students page by page, staff at once).
    .index("by_role_and_universityId", ["role", "universityId"]),

  invites: defineTable({
    // Lowercased. Only a signed-in user with this exact email can accept.
    email: v.string(),
    // Absent for an independent teacher (private lessons, a school class): only the
    // super admin sends those, and only for the lecturer role.
    universityId: v.optional(v.id("universities")),
    role: inviteRoleValidator,
    token: v.string(),
    invitedBy: v.id("users"),
    expiresAt: v.number(),
    acceptedAt: v.optional(v.number()),
    acceptedBy: v.optional(v.id("users")),
    revokedAt: v.optional(v.number()),
    // The Resend component's id of the last invitation email, and when it was queued.
    emailId: v.optional(v.string()),
    emailedAt: v.optional(v.number()),
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
    // Absent for a course outside any university (a school class, private lessons).
    universityId: v.optional(v.id("universities")),
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
    .index("by_joinCode", ["joinCode"])
    // The admin panel lists courses by status, platform-wide or inside one university.
    .index("by_status", ["status"])
    .index("by_universityId_and_status", ["universityId", "status"]),

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
    // Tasks and quizzes can sit in a week; midterms and finals stay in the
    // course's Exams section. Absent: not placed yet.
    weekId: v.optional(v.id("weeks")),
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

  // A student in a course. Two ways in, tracked separately so leaving one keeps
  // the other: the course's join code, and groups the course is shared with.
  // The row goes away when the last way in does (model/groups.ts).
  enrollments: defineTable({
    courseId: v.id("courses"),
    userId: v.id("users"),
    status: enrollmentStatusValidator,
    enrolledAt: v.number(),
    // Joined with the course's code. Absent on rows from before groups, which all came from codes.
    viaCode: v.optional(v.boolean()),
    // Groups of the student's that the course is shared with.
    groupIds: v.optional(v.array(v.id("groups"))),
  })
    .index("by_userId", ["userId"])
    .index("by_courseId", ["courseId"])
    .index("by_courseId_and_userId", ["courseId", "userId"]),

  // -------------------------------------------------------------------------
  // Groups
  // -------------------------------------------------------------------------

  // A class of students: "ICT-24-1", "Saturday tutoring". A university's groups
  // are made by its admins and shared by every lecturer who teaches them, so a
  // class exists once however many lecturers it has. Students join through the
  // group's link or a personal email invite; every course shared with the group
  // reaches all of its members.
  groups: defineTable({
    // Who made it: a university admin, or an independent teacher for their own group.
    ownerId: v.id("users"),
    // The university it belongs to: its admins manage it, its lecturers find and
    // join it. Absent for an independent teacher's private group, which only its
    // owner manages and nobody else can find. Also absent on rows made before
    // groups moved to admins, until groups.migrateToUniversityGroups runs.
    universityId: v.optional(v.id("universities")),
    name: v.string(),
    // The name lowercased with spaces squeezed (groupNameKey): a university
    // can't have two groups whose names differ only in case or spacing.
    nameKey: v.optional(v.string()),
    description: v.optional(v.string()),
    // The secret in the group's shared link (app.kalami.space/join/<code>).
    inviteCode: v.string(),
    inviteEnabled: v.boolean(),
    archivedAt: v.optional(v.number()),
    // Kept in step by every join, leave and invite change, so lists and the
    // member cap never have to count rows. Absent on rows made before they existed.
    memberCount: v.optional(v.number()),
    pendingInvites: v.optional(v.number()),
    createdVia: viaValidator,
    updatedAt: v.number(),
  })
    .index("by_ownerId", ["ownerId"])
    .index("by_inviteCode", ["inviteCode"])
    .index("by_universityId_and_nameKey", ["universityId", "nameKey"]),

  // The lecturers teaching a group: they joined it (a university's group) or
  // made it (an independent teacher's own). They share their own courses with
  // it; they don't manage its students.
  groupLecturers: defineTable({
    groupId: v.id("groups"),
    userId: v.id("users"),
    joinedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_groupId_and_userId", ["groupId", "userId"]),

  groupMembers: defineTable({
    groupId: v.id("groups"),
    userId: v.id("users"),
    via: groupJoinViaValidator,
    joinedAt: v.number(),
  })
    .index("by_groupId", ["groupId"])
    .index("by_userId", ["userId"])
    .index("by_groupId_and_userId", ["groupId", "userId"]),

  // A personal invite emailed to one address. Only an account with that verified
  // email can accept it; it also shows on that student's dashboard.
  groupInvites: defineTable({
    groupId: v.id("groups"),
    // Lowercased.
    email: v.string(),
    token: v.string(),
    invitedBy: v.id("users"),
    expiresAt: v.number(),
    acceptedAt: v.optional(v.number()),
    acceptedBy: v.optional(v.id("users")),
    revokedAt: v.optional(v.number()),
    // The Resend component's id of the last email sent for it.
    emailId: v.optional(v.string()),
    emailedAt: v.optional(v.number()),
  })
    .index("by_token", ["token"])
    .index("by_groupId", ["groupId"])
    // Open invites only: neither accepted nor withdrawn.
    .index("by_groupId_and_acceptedAt_and_revokedAt", ["groupId", "acceptedAt", "revokedAt"])
    .index("by_email", ["email"])
    .index("by_emailId", ["emailId"]),

  // Which groups a course is shared with.
  courseGroups: defineTable({
    courseId: v.id("courses"),
    groupId: v.id("groups"),
    addedBy: v.id("users"),
    addedAt: v.number(),
  })
    .index("by_courseId", ["courseId"])
    .index("by_groupId", ["groupId"])
    .index("by_courseId_and_groupId", ["courseId", "groupId"]),

  // -------------------------------------------------------------------------
  // Course materials
  // -------------------------------------------------------------------------

  // The course's folder in a lecturer's Google Drive. The files stay theirs:
  // Kalami only creates folders and shares published weeks by link.
  readingDocuments: defineTable({
    courseId: v.id("courses"),
    weekId: v.id("weeks"),
    key: v.string(),
    ownerId: v.id("users"),
    folderId: v.string(),
    documentId: v.optional(v.string()),
    // Never blindly repeat an ambiguous Google file creation.
    createAttempted: v.boolean(),
    updatedAt: v.number(),
  }).index("by_weekId_and_key", ["weekId", "key"]).index("by_courseId", ["courseId"]),

  courseDrive: defineTable({
    courseId: v.id("courses"),
    // Whose Drive. Only this person's Google connection is ever used for the course.
    ownerId: v.id("users"),
    folderId: v.optional(v.string()),
    // Set while the folder is being created, so a second click doesn't make another.
    creatingSince: v.optional(v.number()),
    error: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_courseId", ["courseId"]),

  // Replaced by `weeks` (migrations.ts moves the rows); kept only until every
  // deployment has run that migration, then removed.
  materials: defineTable({
    courseId: v.id("courses"),
    order: v.number(),
    title: v.string(),
    description: v.optional(v.string()),
    source: materialsSourceValidator,
    status: materialsStatusValidator,
    // Drive: the week's folder and the "anyone with the link" permission on it.
    folderId: v.optional(v.string()),
    permissionId: v.optional(v.string()),
    // Drive work in flight, so the page can say so and a second click waits.
    syncing: v.optional(v.union(v.literal("folder"), v.literal("share"), v.literal("unshare"))),
    syncingSince: v.optional(v.number()),
    // The last Drive failure, in words the lecturer can act on.
    driveError: v.optional(v.string()),
    // Link: an https URL the lecturer manages access to.
    url: v.optional(v.string()),
    publishedAt: v.optional(v.number()),
    createdBy: v.id("users"),
    createdVia: viaValidator,
    updatedAt: v.number(),
  }).index("by_courseId_and_order", ["courseId", "order"]),

  // -------------------------------------------------------------------------
  // Course outline
  // -------------------------------------------------------------------------

  // The backbone of a course: "Week 1", or any title the lecturer gives it
  // ("Unit 2 · Forms"). A week holds lessons written in Kalami, materials (a
  // folder in the lecturer's Google Drive and any number of links), and the
  // tasks and quizzes placed in it. Students see it once it's published.
  weeks: defineTable({
    readingWrite: v.optional(v.object({ id: v.string(), until: v.number() })),
    courseId: v.id("courses"),
    order: v.number(),
    title: v.string(),
    description: v.optional(v.string()),
    status: publishStatusValidator,
    publishedAt: v.optional(v.number()),
    // Materials: links, in the order the lecturer put them.
    links: v.array(weekLinkValidator),
    // Materials: the week's folder in the course's Drive, and the "anyone with
    // the link" permission on it while the week is published.
    folderId: v.optional(v.string()),
    permissionId: v.optional(v.string()),
    // Drive work in flight, so the page can say so and a second click waits.
    syncing: v.optional(v.union(v.literal("folder"), v.literal("share"), v.literal("unshare"))),
    syncingSince: v.optional(v.number()),
    // The last Drive failure, in words the lecturer can act on.
    driveError: v.optional(v.string()),
    createdBy: v.id("users"),
    createdVia: viaValidator,
    updatedAt: v.number(),
  }).index("by_courseId_and_order", ["courseId", "order"]),

  // A lesson written in Kalami: blocks of text, tips, code, images, video,
  // step-by-step reveals and quick checks. Its own draft/published state, so an
  // agent can draft one inside a week students already see.
  lessons: defineTable({
    courseId: v.id("courses"),
    weekId: v.id("weeks"),
    order: v.number(),
    title: v.string(),
    status: publishStatusValidator,
    publishedAt: v.optional(v.number()),
    blocks: v.array(lessonBlockValidator),
    createdBy: v.id("users"),
    createdVia: viaValidator,
    updatedAt: v.number(),
  })
    .index("by_weekId_and_order", ["weekId", "order"])
    .index("by_courseId", ["courseId"]),

  // Presentations: a deck of typed slides in a curated theme, inside a week
  // next to its lessons (lib/presentation has the vocabulary and the rules;
  // components/presentations plays it). Its own draft/published state, like a lesson.
  presentations: defineTable({
    courseId: v.id("courses"),
    weekId: v.id("weeks"),
    order: v.number(),
    title: v.string(),
    theme: deckThemeValidator,
    slides: v.array(slideValidator),
    status: publishStatusValidator,
    publishedAt: v.optional(v.number()),
    createdBy: v.id("users"),
    createdVia: viaValidator,
    updatedAt: v.number(),
    // Its public link, while it has one: anyone with the link watches it on
    // the student app's /p/<token>, no account needed. `notes`: link viewers
    // see the speaker notes too. `by` made the current link.
    share: v.optional(v.object({ token: v.string(), notes: v.boolean(), by: v.id("users"), at: v.number() })),
  })
    .index("by_weekId_and_order", ["weekId", "order"])
    .index("by_courseId", ["courseId"])
    .index("by_shareToken", ["share.token"]),

  // -------------------------------------------------------------------------
  // Messages (the contact card)
  // -------------------------------------------------------------------------

  // A private thread a student starts with one of their lecturers or with the
  // Kalami team (the super admins). Only the student, that lecturer, or (for
  // the team) a super admin can read it; nobody else, admins included.
  conversations: defineTable({
    studentId: v.id("users"),
    recipient: contactRecipientValidator,
    // Set when recipient is "lecturer": the one lecturer the student chose.
    lecturerId: v.optional(v.id("users")),
    // What it's about, re-checked on the server when the student sent it.
    courseId: v.optional(v.id("courses")),
    // Legacy (before weeks); new conversations use weekId.
    materialId: v.optional(v.id("materials")),
    weekId: v.optional(v.id("weeks")),
    assessmentId: v.optional(v.id("assessments")),
    topic: contactTopicValidator,
    customTopic: v.optional(v.string()),
    subject: v.string(),
    status: conversationStatusValidator,
    lastMessageAt: v.number(),
    lastMessageFrom: v.union(v.literal("student"), v.literal("staff")),
    messageCount: v.number(),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_studentId_and_lastMessageAt", ["studentId", "lastMessageAt"])
    .index("by_lecturerId_and_lastMessageAt", ["lecturerId", "lastMessageAt"])
    .index("by_recipient_and_lastMessageAt", ["recipient", "lastMessageAt"])
    .index("by_status_and_resolvedAt", ["status", "resolvedAt"]),

  conversationMessages: defineTable({
    conversationId: v.id("conversations"),
    senderId: v.id("users"),
    from: v.union(v.literal("student"), v.literal("staff")),
    // Plain text; the apps never render it as HTML.
    body: v.string(),
    // The sender's own id for this send, so a double tap or a retry after a
    // timeout lands once.
    clientOpId: v.string(),
    // Notification emails queued for it (Resend component ids), and why none were, if so.
    emailIds: v.optional(v.array(v.string())),
    emailSkipped: v.optional(v.string()),
  })
    .index("by_conversationId", ["conversationId"])
    .index("by_senderId_and_clientOpId", ["senderId", "clientOpId"]),

  // How far each participant has read a conversation.
  conversationReads: defineTable({
    conversationId: v.id("conversations"),
    userId: v.id("users"),
    lastReadAt: v.number(),
  })
    .index("by_userId_and_conversationId", ["userId", "conversationId"])
    .index("by_conversationId", ["conversationId"]),

  // -------------------------------------------------------------------------
  // Email bookkeeping
  // -------------------------------------------------------------------------

  // Which address each invite or message email went to, so a bounce or spam
  // complaint reported by Resend can be traced back to it.
  emailLog: defineTable({
    emailId: v.string(),
    email: v.string(),
  }).index("by_emailId", ["emailId"]),

  // Addresses Kalami no longer emails because they bounced, complained, or
  // unsubscribed from a message sent to them before they had an account.
  emailSuppressions: defineTable({
    email: v.string(),
    status: v.union(v.literal("bounced"), v.literal("complained"), v.literal("unsubscribed")),
    at: v.number(),
  }).index("by_email", ["email"]),

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
    // Automatic grading threw (a page too big to check, for one): submitted with
    // score 0 and this message, for the lecturer to grade by hand.
    gradingError: v.optional(v.string()),
    // How many times the cron handed this attempt to grading; bounded, so a
    // grading run that keeps getting killed can't be retried forever.
    gradingTries: v.optional(v.number()),
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
    // The work it's about. Absent on an announcement from the notification center.
    courseId: v.optional(v.id("courses")),
    assessmentId: v.optional(v.id("assessments")),
    assessmentKind: v.optional(assessmentKindValidator),
    // Copied here so a row reads on its own, in the bell, a push or an email.
    title: v.string(),
    // On an announcement: who it's from ("Kalami" or the university), shown where the course would be.
    courseTitle: v.string(),
    // An announcement's text, and the broadcast it came from.
    body: v.optional(v.string()),
    broadcastId: v.optional(v.id("broadcasts")),
    // The closing time, shown as "due …" in the student's own time zone.
    dueAt: v.optional(v.number()),
    // Where tapping it goes, as a path in the student app.
    href: v.string(),
    readAt: v.optional(v.number()),
    // The email that carried it (the Resend component's id), once one was queued.
    emailId: v.optional(v.string()),
    emailedAt: v.optional(v.number()),
    // When it went out as a push to the student's devices (push.ts), so a retried batch never pushes twice.
    pushedAt: v.optional(v.number()),
  })
    .index("by_userId", ["userId"])
    .index("by_userId_and_readAt", ["userId", "readAt"])
    .index("by_emailId", ["emailId"])
    // Clearing out a deleted course.
    .index("by_courseId", ["courseId"]),

  // A device (browser) a student turned push notifications on in. The endpoint
  // is the push service's URL for that device; the keys encrypt the payload to
  // it. Gone when the student turns push off, or when the push service says
  // the device is gone (404/410).
  pushSubscriptions: defineTable({
    userId: v.id("users"),
    endpoint: v.string(),
    keys: v.object({ p256dh: v.string(), auth: v.string() }),
    // What the browser said about itself, so a student can tell their devices apart.
    userAgent: v.optional(v.string()),
    // Last subscribe or successful push.
    lastUsedAt: v.number(),
    // Pushes that failed in a row for other reasons; the row goes after too many.
    failures: v.optional(v.number()),
  })
    .index("by_userId", ["userId"])
    .index("by_endpoint", ["endpoint"]),

  // One row per (assessment, kind) once its notifications went out, so a cron
  // run or a second publish never sends them twice.
  notificationRuns: defineTable({
    assessmentId: v.id("assessments"),
    kind: notificationKindValidator,
    at: v.number(),
    // Students told so far; the fan-out adds to it batch by batch.
    sent: v.number(),
  }).index("by_assessmentId_and_kind", ["assessmentId", "kind"]),

  // What an agent's creating tool returned for a request id, so a retried call
  // (a lost response, a client that resends) returns the same ids instead of
  // creating a second course, assessment or batch of questions.
  agentRequests: defineTable({
    actorId: v.id("users"),
    requestId: v.string(),
    result: v.union(v.string(), v.array(v.string())),
    at: v.number(),
  }).index("by_actorId_and_requestId", ["actorId", "requestId"]),

  // A message from the admin panel's notification center to many people at
  // once: the bell (students), a push and/or an email, as chosen. Sent in
  // batches by broadcasts.fanOut; the counts grow as the batches run.
  broadcasts: defineTable({
    senderId: v.id("users"),
    // Who people see it from: Kalami itself, or the university whose admin sent it.
    from: localizedTextValidator,
    title: v.string(),
    body: v.string(),
    // Where "Open" goes: a path in the student app or an https link.
    link: v.optional(v.string()),
    // The message is also a personal invitation to this group (each person gets their own join link).
    groupId: v.optional(v.id("groups")),
    audience: broadcastAudienceValidator,
    // The audience in words at the time of sending, for the history.
    audienceLabel: v.string(),
    channels: broadcastChannelsValidator,
    // Email people who switched notification emails off too (important notices). Never bounced addresses.
    emailEveryone: v.boolean(),
    status: v.union(v.literal("sending"), v.literal("sent")),
    recipients: v.number(),
    inApp: v.number(),
    // People with at least one device on when it went out.
    pushed: v.number(),
    emailed: v.number(),
    finishedAt: v.optional(v.number()),
  }).index("by_senderId", ["senderId"]),

  // One row per person a broadcast reached: what they got, and why an email
  // didn't go. A second batch for the same person does nothing.
  broadcastDeliveries: defineTable({
    broadcastId: v.id("broadcasts"),
    // The account, or (without one within the sender's reach) the address that was emailed.
    userId: v.optional(v.id("users")),
    email: v.optional(v.string()),
    notificationId: v.optional(v.id("notifications")),
    // The personal group invite this message carried.
    inviteId: v.optional(v.id("groupInvites")),
    // Devices with push on when it was sent (the pushes themselves go through pushDelivery.ts).
    devices: v.number(),
    emailId: v.optional(v.string()),
    emailSkipped: v.optional(
      v.union(v.literal("off"), v.literal("opted_out"), v.literal("blocked"), v.literal("not_configured")),
    ),
  })
    .index("by_broadcastId", ["broadcastId"])
    .index("by_broadcastId_and_userId", ["broadcastId", "userId"])
    .index("by_broadcastId_and_email", ["broadcastId", "email"]),

  // Who changed what, and whether a person or their agent did it.
  auditLog: defineTable({
    actorId: v.id("users"),
    via: viaValidator,
    // MCP: the OAuth client the agent connected through (claude.ai, ChatGPT, …).
    client: v.optional(v.string()),
    action: v.string(),
    targetTable: v.string(),
    targetId: v.string(),
    // The course the change belongs to, so a course page can show its history.
    courseId: v.optional(v.id("courses")),
    summary: v.string(),
    at: v.number(),
  })
    .index("by_courseId", ["courseId"])
    .index("by_actorId", ["actorId"])
    // The admin panel filters the log by what was changed.
    .index("by_targetTable", ["targetTable"]),
});
