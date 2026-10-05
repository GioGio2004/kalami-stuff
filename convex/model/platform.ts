import type { PaginationOptions, PaginationResult } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Actor } from "../lib/access";
import { getMemberships, isStaffRole, isSuperAdmin, requireUser } from "../lib/auth";
import { appError } from "../lib/errors";
import { normalizeEmail, optionalText, requireText } from "../lib/input";
import { integrityColor, integrityScore } from "../lib/integrity";
import {
  assessmentKindValidator,
  assessmentStatusValidator,
  attemptStatusValidator,
  courseStatusValidator,
  courseStaffRoleValidator,
  enrollmentStatusValidator,
  groupJoinViaValidator,
  integrityColorValidator,
  localeValidator,
  localizedTextValidator,
  roleValidator,
  universityStatusValidator,
  viaValidator,
  type Role,
} from "../lib/validators";
import { displayName, logAudit } from "./audit";

/**
 * The admin panel: the super admin's view of the whole platform, and a
 * university admin's view of their own university. Every function here
 * resolves the caller's scope first (requireAdminScope) and reads only inside
 * it; a university admin asking about another university gets FORBIDDEN or
 * NOT_FOUND, never data.
 *
 * Counts are bounded: each count reads at most COUNT_CAP rows and says so
 * (`capped`), so one page never scans an unbounded table.
 */

// --- Scope ------------------------------------------------------------------------------

export type AdminScope = {
  user: Doc<"users">;
  memberships: Doc<"memberships">[];
  isSuperAdmin: boolean;
  /** Universities the caller administers; null for the super admin, who administers all of them. */
  universityIds: Id<"universities">[] | null;
};

/** A university admin or the super admin. Everyone else is refused. */
export async function requireAdminScope(ctx: QueryCtx): Promise<AdminScope> {
  const user = await requireUser(ctx);
  const memberships = await getMemberships(ctx, user._id);
  if (isSuperAdmin(memberships)) {
    return { user, memberships, isSuperAdmin: true, universityIds: null };
  }
  const universityIds = [
    ...new Set(memberships.flatMap((m) => (m.role === "uni_admin" && m.universityId !== undefined ? [m.universityId] : []))),
  ];
  if (universityIds.length === 0) {
    throw appError("FORBIDDEN", "Only university admins and the platform admin can do this.");
  }
  return { user, memberships, isSuperAdmin: false, universityIds };
}

export async function requireSuperAdminScope(ctx: QueryCtx): Promise<AdminScope> {
  const scope = await requireAdminScope(ctx);
  if (!scope.isSuperAdmin) {
    throw appError("FORBIDDEN", "Only the platform admin can do this.");
  }
  return scope;
}

export function actorOf(scope: AdminScope): Actor {
  return { user: scope.user, memberships: scope.memberships, via: "web" };
}

/** Which universities a page is about: one, "none" (records outside any university), or everything the caller administers. */
export const universityFilterValidator = v.optional(v.union(v.id("universities"), v.literal("none")));
export type UniversityFilter = Id<"universities"> | "none" | undefined;

/** Universities a request covers: null is every one (super admin only); in a list, undefined means "no university". */
export type Coverage = null | (Id<"universities"> | undefined)[];

export function coverage(scope: AdminScope, filter: UniversityFilter): Coverage {
  if (scope.universityIds === null) {
    if (filter === undefined) return null;
    return [filter === "none" ? undefined : filter];
  }
  if (filter === undefined) return scope.universityIds;
  if (filter === "none" || !scope.universityIds.includes(filter)) {
    throw appError("FORBIDDEN", "You don't administer that university.");
  }
  return [filter];
}

/** Lists that come a page at a time cover everything (super admin) or exactly one university. */
function singleCoverage(
  scope: AdminScope,
  filter: UniversityFilter,
): { all: true } | { all: false; universityId: Id<"universities"> | undefined } {
  const covered = coverage(scope, filter);
  if (covered === null) return { all: true };
  if (covered.length !== 1) {
    throw appError("INVALID_INPUT", "Pick one university.");
  }
  return { all: false, universityId: covered[0] };
}

/** Whether a record belonging to this university (or to none) is within the caller's reach. */
export function covers(scope: AdminScope, universityId: Id<"universities"> | undefined): boolean {
  return scope.universityIds === null || (universityId !== undefined && scope.universityIds.includes(universityId));
}

function inCoverage(covered: Coverage, universityId: Id<"universities"> | undefined): boolean {
  return covered === null || covered.includes(universityId);
}

// --- Lookups ------------------------------------------------------------------------------

/** Rows read once per request, however many lines mention them. */
class Lookup {
  private universities = new Map<Id<"universities">, Doc<"universities"> | null>();
  private users = new Map<Id<"users">, Doc<"users"> | null>();
  private courses = new Map<Id<"courses">, Doc<"courses"> | null>();
  private groups = new Map<Id<"groups">, Doc<"groups"> | null>();

  constructor(private ctx: QueryCtx) {}

  private async cached<K, V>(map: Map<K, V | null>, key: K, load: () => Promise<V | null>) {
    if (!map.has(key)) map.set(key, await load());
    return map.get(key) ?? null;
  }

  university(id: Id<"universities"> | undefined) {
    return id === undefined
      ? Promise.resolve(null)
      : this.cached(this.universities, id, () => this.ctx.db.get("universities", id));
  }
  user(id: Id<"users">) {
    return this.cached(this.users, id, () => this.ctx.db.get("users", id));
  }
  course(id: Id<"courses">) {
    return this.cached(this.courses, id, () => this.ctx.db.get("courses", id));
  }
  group(id: Id<"groups">) {
    return this.cached(this.groups, id, () => this.ctx.db.get("groups", id));
  }
}

const COUNT_CAP = 5000;
const COURSE_CAP = 1000;
const GROUP_CAP = 1000;
const INVITE_CAP = 1000;
/** Courses whose assessments the overview counts; beyond this the figure says "approximately". */
const ASSESSMENT_COURSE_CAP = 300;
const PER_USER_CAP = 200;
const STAFF_CAP = 1000;
const SEARCH_CAP = 50;

function nameOf(user: Doc<"users">): string {
  return [user.firstName, user.lastName].filter(Boolean).join(" ");
}

function membershipsIn(ctx: QueryCtx, universityId: Id<"universities"> | undefined, role: Role, cap: number) {
  return ctx.db
    .query("memberships")
    .withIndex("by_universityId_and_role", (q) => q.eq("universityId", universityId).eq("role", role))
    .take(cap);
}

/** How many people hold a role inside the coverage, up to COUNT_CAP per university. */
async function countRole(ctx: QueryCtx, covered: Coverage, role: Role): Promise<{ count: number; capped: boolean }> {
  if (covered === null) {
    const rows = await ctx.db
      .query("memberships")
      .withIndex("by_role_and_universityId", (q) => q.eq("role", role))
      .take(COUNT_CAP);
    return { count: rows.length, capped: rows.length === COUNT_CAP };
  }
  let count = 0;
  let capped = false;
  for (const universityId of covered) {
    const rows = await membershipsIn(ctx, universityId, role, COUNT_CAP);
    count += rows.length;
    capped ||= rows.length === COUNT_CAP;
  }
  return { count, capped };
}

async function coursesIn(ctx: QueryCtx, covered: Coverage): Promise<Doc<"courses">[]> {
  if (covered === null) {
    return await ctx.db.query("courses").order("desc").take(COURSE_CAP);
  }
  const out: Doc<"courses">[] = [];
  for (const universityId of covered) {
    out.push(
      ...(await ctx.db
        .query("courses")
        .withIndex("by_universityId", (q) => q.eq("universityId", universityId))
        .order("desc")
        .take(COURSE_CAP)),
    );
  }
  return out;
}

async function groupsIn(ctx: QueryCtx, covered: Coverage): Promise<Doc<"groups">[]> {
  if (covered === null) {
    return await ctx.db.query("groups").order("desc").take(GROUP_CAP);
  }
  const out: Doc<"groups">[] = [];
  for (const universityId of covered) {
    out.push(
      ...(await ctx.db
        .query("groups")
        .withIndex("by_universityId_and_nameKey", (q) => q.eq("universityId", universityId))
        .take(GROUP_CAP)),
    );
  }
  return out;
}

function isPendingInvite(invite: Doc<"invites">, now: number): boolean {
  return invite.acceptedAt === undefined && invite.revokedAt === undefined && invite.expiresAt > now;
}

async function pendingInvitesIn(ctx: QueryCtx, covered: Coverage, now: number): Promise<number> {
  if (covered === null) {
    const rows = await ctx.db.query("invites").order("desc").take(INVITE_CAP);
    return rows.filter((invite) => isPendingInvite(invite, now)).length;
  }
  let count = 0;
  for (const universityId of covered) {
    const rows = await ctx.db
      .query("invites")
      .withIndex("by_universityId", (q) => q.eq("universityId", universityId))
      .take(INVITE_CAP);
    count += rows.filter((invite) => isPendingInvite(invite, now)).length;
  }
  return count;
}

async function assessmentsOf(ctx: QueryCtx, courseId: Id<"courses">) {
  return await ctx.db
    .query("assessments")
    .withIndex("by_courseId", (q) => q.eq("courseId", courseId))
    .take(500);
}

async function activeStudentsOf(ctx: QueryCtx, courseId: Id<"courses">): Promise<number> {
  const rows = await ctx.db
    .query("enrollments")
    .withIndex("by_courseId", (q) => q.eq("courseId", courseId))
    .take(2000);
  return rows.filter((row) => row.status === "active").length;
}

async function attemptsOf(
  ctx: QueryCtx,
  assessmentId: Id<"assessments">,
  status: "in_progress" | "submitted",
): Promise<number> {
  const rows = await ctx.db
    .query("attempts")
    .withIndex("by_assessmentId_and_status", (q) => q.eq("assessmentId", assessmentId).eq("status", status))
    .take(2000);
  return rows.length;
}

function statusCounts<Status extends string>(
  rows: { status: Status }[],
  statuses: readonly Status[],
): Record<Status, number> {
  const out = Object.fromEntries(statuses.map((status) => [status, 0])) as Record<Status, number>;
  for (const row of rows) out[row.status]++;
  return out;
}

const statusTrioValidator = v.object({ draft: v.number(), published: v.number(), archived: v.number() });
const STATUSES = ["draft", "published", "archived"] as const;

// --- Overview -----------------------------------------------------------------------------

export const auditLineValidator = v.object({
  _id: v.id("auditLog"),
  at: v.number(),
  via: viaValidator,
  client: v.optional(v.string()),
  action: v.string(),
  targetTable: v.string(),
  targetId: v.string(),
  courseId: v.optional(v.id("courses")),
  courseTitle: v.optional(v.string()),
  summary: v.string(),
  actorName: v.string(),
  actorEmail: v.optional(v.string()),
});

type AuditLine = typeof auditLineValidator.type;

async function toAuditLine(ctx: QueryCtx, lookup: Lookup, row: Doc<"auditLog">): Promise<AuditLine> {
  const actor = await lookup.user(row.actorId);
  const course = row.courseId === undefined ? null : await lookup.course(row.courseId);
  return {
    _id: row._id,
    at: row.at,
    via: row.via,
    client: row.client,
    action: row.action,
    targetTable: row.targetTable,
    targetId: row.targetId,
    courseId: row.courseId,
    courseTitle: course?.title,
    summary: row.summary,
    actorName: displayName(actor),
    actorEmail: actor === null || actor.deletedAt !== undefined ? undefined : actor.email,
  };
}

export const overviewValidator = v.object({
  isSuperAdmin: v.boolean(),
  /** Universities the caller administers (every one for the super admin), for the scope picker. */
  universities: v.array(
    v.object({ _id: v.id("universities"), name: localizedTextValidator, status: universityStatusValidator }),
  ),
  people: v.object({
    students: v.number(),
    lecturers: v.number(),
    uniAdmins: v.number(),
    /** Super admin only. */
    superAdmins: v.optional(v.number()),
    /** A count hit its cap, so it's a floor. */
    capped: v.boolean(),
  }),
  courses: v.object({ ...statusTrioValidator.fields, total: v.number() }),
  assessments: v.object({
    ...statusTrioValidator.fields,
    byKind: v.object({ task: v.number(), quiz: v.number(), midterm: v.number(), final: v.number() }),
    /** Only the first few hundred courses were counted. */
    approximate: v.boolean(),
  }),
  groups: v.object({ active: v.number(), archived: v.number() }),
  pendingInvites: v.number(),
  /** Super admin only: conversations waiting for the Kalami team. */
  openTeamConversations: v.optional(v.number()),
  live: v.object({
    attemptsInProgress: v.number(),
    closingSoon: v.array(
      v.object({
        assessmentId: v.id("assessments"),
        title: v.string(),
        kind: assessmentKindValidator,
        courseId: v.id("courses"),
        courseTitle: v.string(),
        closesAt: v.number(),
        inProgress: v.number(),
      }),
    ),
  }),
  /** Super admin only: the latest changes anywhere. */
  recent: v.array(auditLineValidator),
});

const CLOSING_WINDOW_MS = 2 * 60 * 60 * 1000;

export async function administeredUniversities(ctx: QueryCtx, scope: AdminScope) {
  if (scope.universityIds === null) {
    return await ctx.db.query("universities").order("desc").take(200);
  }
  const rows = await Promise.all(scope.universityIds.map((id) => ctx.db.get("universities", id)));
  return rows.flatMap((row) => (row === null ? [] : [row]));
}

export async function getOverview(ctx: QueryCtx, scope: AdminScope, filter: UniversityFilter, now: number) {
  const covered = coverage(scope, filter);
  const lookup = new Lookup(ctx);

  const [students, lecturers, uniAdmins] = await Promise.all([
    countRole(ctx, covered, "student"),
    countRole(ctx, covered, "lecturer"),
    countRole(ctx, covered, "uni_admin"),
  ]);
  const superAdmins = scope.isSuperAdmin ? (await countRole(ctx, null, "super_admin")).count : undefined;

  const courses = await coursesIn(ctx, covered);
  const courseCounts = statusCounts(courses, STATUSES);
  const counted = courses.slice(0, ASSESSMENT_COURSE_CAP);
  const assessments: Doc<"assessments">[] = [];
  for (const course of counted) {
    assessments.push(...(await assessmentsOf(ctx, course._id)));
  }
  const byKind = { task: 0, quiz: 0, midterm: 0, final: 0 };
  for (const assessment of assessments) byKind[assessment.kind]++;

  const groups = await groupsIn(ctx, covered);

  // What students are doing right now, inside the coverage.
  const inProgress = await ctx.db
    .query("attempts")
    .withIndex("by_status_and_deadlineAt", (q) => q.eq("status", "in_progress"))
    .take(2000);
  let attemptsInProgress = 0;
  for (const attempt of inProgress) {
    const course = await lookup.course(attempt.courseId);
    if (course !== null && inCoverage(covered, course.universityId)) attemptsInProgress++;
  }
  const closing = await ctx.db
    .query("assessments")
    .withIndex("by_status_and_closesAt", (q) =>
      q.eq("status", "published").gte("settings.closesAt", now).lte("settings.closesAt", now + CLOSING_WINDOW_MS),
    )
    .take(50);
  const closingSoon = [];
  for (const assessment of closing) {
    const course = await lookup.course(assessment.courseId);
    if (course === null || !inCoverage(covered, course.universityId)) continue;
    closingSoon.push({
      assessmentId: assessment._id,
      title: assessment.title,
      kind: assessment.kind,
      courseId: course._id,
      courseTitle: course.title,
      closesAt: assessment.settings.closesAt ?? now,
      inProgress: await attemptsOf(ctx, assessment._id, "in_progress"),
    });
  }

  let openTeamConversations: number | undefined;
  const recent = [];
  if (scope.isSuperAdmin) {
    const team = await ctx.db
      .query("conversations")
      .withIndex("by_recipient_and_lastMessageAt", (q) => q.eq("recipient", "admin"))
      .order("desc")
      .take(500);
    openTeamConversations = team.filter((row) => row.status === "open").length;
    for (const row of await ctx.db.query("auditLog").order("desc").take(10)) {
      recent.push(await toAuditLine(ctx, lookup, row));
    }
  }

  return {
    isSuperAdmin: scope.isSuperAdmin,
    universities: (await administeredUniversities(ctx, scope)).map((u) => ({ _id: u._id, name: u.name, status: u.status })),
    people: {
      students: students.count,
      lecturers: lecturers.count,
      uniAdmins: uniAdmins.count,
      superAdmins,
      capped: students.capped || lecturers.capped || uniAdmins.capped,
    },
    courses: { ...courseCounts, total: courses.length },
    assessments: { ...statusCounts(assessments, STATUSES), byKind, approximate: courses.length > counted.length },
    groups: {
      active: groups.filter((g) => g.archivedAt === undefined).length,
      archived: groups.filter((g) => g.archivedAt !== undefined).length,
    },
    pendingInvites: await pendingInvitesIn(ctx, covered, now),
    openTeamConversations,
    live: { attemptsInProgress, closingSoon },
    recent,
  };
}

// --- Universities -------------------------------------------------------------------------

export const universityRowValidator = v.object({
  _id: v.id("universities"),
  _creationTime: v.number(),
  name: localizedTextValidator,
  slug: v.string(),
  status: universityStatusValidator,
  students: v.number(),
  lecturers: v.number(),
  admins: v.number(),
  courses: v.number(),
  publishedCourses: v.number(),
  groups: v.number(),
  pendingInvites: v.number(),
});

export async function listUniversities(ctx: QueryCtx, scope: AdminScope, now: number) {
  const out = [];
  for (const university of await administeredUniversities(ctx, scope)) {
    const covered: Coverage = [university._id];
    const courses = await coursesIn(ctx, covered);
    out.push({
      _id: university._id,
      _creationTime: university._creationTime,
      name: university.name,
      slug: university.slug,
      status: university.status,
      students: (await countRole(ctx, covered, "student")).count,
      lecturers: (await countRole(ctx, covered, "lecturer")).count,
      admins: (await countRole(ctx, covered, "uni_admin")).count,
      courses: courses.length,
      publishedCourses: courses.filter((c) => c.status === "published").length,
      groups: (await groupsIn(ctx, covered)).length,
      pendingInvites: await pendingInvitesIn(ctx, covered, now),
    });
  }
  return out;
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Rename a university, change its slug, or archive/restore it. Super admin only. */
export async function updateUniversity(
  ctx: MutationCtx,
  scope: AdminScope,
  universityId: Id<"universities">,
  patch: { nameKa?: string; nameEn?: string; slug?: string; status?: "active" | "archived" },
) {
  if (!scope.isSuperAdmin) {
    throw appError("FORBIDDEN", "Only the platform admin can change a university.");
  }
  const university = await ctx.db.get("universities", universityId);
  if (university === null) {
    throw appError("NOT_FOUND", "University not found.");
  }
  const changes: Partial<Doc<"universities">> = {};
  if (patch.nameKa !== undefined || patch.nameEn !== undefined) {
    changes.name = {
      ka: patch.nameKa === undefined ? university.name.ka : requireText(patch.nameKa, "Georgian name", 120),
      en: patch.nameEn === undefined ? university.name.en : requireText(patch.nameEn, "English name", 120),
    };
  }
  if (patch.slug !== undefined) {
    const slug = patch.slug.trim().toLowerCase();
    if (slug.length > 40 || !SLUG_PATTERN.test(slug)) {
      throw appError("INVALID_INPUT", "Slug: lowercase letters, digits and single dashes, e.g. gori-state.");
    }
    const taken = await ctx.db
      .query("universities")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (taken !== null && taken._id !== universityId) {
      throw appError("CONFLICT", `The slug "${slug}" is already used.`);
    }
    changes.slug = slug;
  }
  if (patch.status !== undefined && patch.status !== university.status) {
    changes.status = patch.status;
  }
  if (Object.keys(changes).length === 0) {
    return;
  }
  await ctx.db.patch("universities", universityId, changes);
  const statusOnly = changes.status !== undefined && Object.keys(changes).length === 1;
  await logAudit(ctx, actorOf(scope), {
    action: statusOnly ? `university.${changes.status}` : "university.update",
    targetTable: "universities",
    targetId: universityId,
    summary: `${statusOnly ? (changes.status === "archived" ? "Archived" : "Restored") : "Updated"} university "${changes.name?.en ?? university.name.en}"`,
  });
}

// --- Students ----------------------------------------------------------------------------

const emailOffValidator = v.optional(v.union(v.literal("opted_out"), v.literal("bounced"), v.literal("complained")));

export const studentRowValidator = v.object({
  userId: v.id("users"),
  membershipId: v.id("memberships"),
  /** Empty while they haven't given a name. */
  name: v.string(),
  email: v.string(),
  avatarUrl: v.optional(v.string()),
  locale: localeValidator,
  universityId: v.optional(v.id("universities")),
  universityName: v.optional(localizedTextValidator),
  faculty: v.optional(v.string()),
  group: v.optional(v.string()),
  year: v.optional(v.number()),
  studentNumber: v.optional(v.string()),
  /** When the account was made. */
  joinedAt: v.number(),
  /** Finished onboarding (name + honesty notice). */
  onboarded: v.boolean(),
  /** Courses they're in (active enrollments) and groups they belong to. */
  courses: v.number(),
  groups: v.number(),
  /** Email delivery stopped: they opted out, or the address bounced or complained. */
  emailOff: emailOffValidator,
});

function emailOffOf(user: Doc<"users">) {
  return user.emailStatus ?? (user.emailOptOut ? ("opted_out" as const) : undefined);
}

async function toStudentRow(ctx: QueryCtx, lookup: Lookup, membership: Doc<"memberships">) {
  const user = await lookup.user(membership.userId);
  if (user === null || user.deletedAt !== undefined) return null;
  const university = await lookup.university(membership.universityId);
  const enrollments = await ctx.db
    .query("enrollments")
    .withIndex("by_userId", (q) => q.eq("userId", user._id))
    .take(PER_USER_CAP);
  const groups = await ctx.db
    .query("groupMembers")
    .withIndex("by_userId", (q) => q.eq("userId", user._id))
    .take(PER_USER_CAP);
  return {
    userId: user._id,
    membershipId: membership._id,
    name: nameOf(user),
    email: user.email,
    avatarUrl: user.avatarUrl,
    locale: user.locale,
    universityId: membership.universityId,
    universityName: university?.name,
    faculty: membership.faculty,
    group: membership.group,
    year: membership.year,
    studentNumber: membership.studentNumber,
    joinedAt: user._creationTime,
    onboarded: user.honestyVersion !== undefined && user.firstName !== undefined && user.lastName !== undefined,
    courses: enrollments.filter((row) => row.status === "active").length,
    groups: groups.length,
    emailOff: emailOffOf(user),
  };
}

type StudentRow = NonNullable<Awaited<ReturnType<typeof toStudentRow>>>;

/** Students inside the coverage, newest accounts first, a page at a time. */
export async function listStudents(
  ctx: QueryCtx,
  scope: AdminScope,
  filter: UniversityFilter,
  paginationOpts: PaginationOptions,
): Promise<PaginationResult<StudentRow>> {
  const where = singleCoverage(scope, filter);
  const result = where.all
    ? await ctx.db
        .query("memberships")
        .withIndex("by_role_and_universityId", (q) => q.eq("role", "student"))
        .order("desc")
        .paginate(paginationOpts)
    : await ctx.db
        .query("memberships")
        .withIndex("by_universityId_and_role", (q) => q.eq("universityId", where.universityId).eq("role", "student"))
        .order("desc")
        .paginate(paginationOpts);
  const lookup = new Lookup(ctx);
  const page: StudentRow[] = [];
  for (const membership of result.page) {
    const row = await toStudentRow(ctx, lookup, membership);
    if (row !== null) page.push(row);
  }
  return { ...result, page };
}

/** Accounts whose email starts with the query (two characters at least), by email. */
async function usersByEmailPrefix(ctx: QueryCtx, rawQuery: string) {
  const needle = normalizeEmail(rawQuery).slice(0, 254);
  if (needle.length < 2) return [];
  const rows = await ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.gte("email", needle).lt("email", `${needle}￿`))
    .take(SEARCH_CAP);
  return rows.filter((user) => user.deletedAt === undefined);
}

export async function searchStudents(ctx: QueryCtx, scope: AdminScope, filter: UniversityFilter, query: string) {
  const covered = coverage(scope, filter);
  const lookup = new Lookup(ctx);
  const out: StudentRow[] = [];
  for (const user of await usersByEmailPrefix(ctx, query)) {
    const membership = (await getMemberships(ctx, user._id)).find((m) => m.role === "student");
    if (membership === undefined || !inCoverage(covered, membership.universityId)) continue;
    const row = await toStudentRow(ctx, lookup, membership);
    if (row !== null) out.push(row);
  }
  return out;
}

export const studentDetailValidator = v.object({
  profile: studentRowValidator,
  enrollments: v.array(
    v.object({
      _id: v.id("enrollments"),
      courseId: v.id("courses"),
      courseTitle: v.string(),
      courseStatus: courseStatusValidator,
      status: enrollmentStatusValidator,
      enrolledAt: v.number(),
      /** Joined with the course's code (as opposed to only through a group). */
      viaCode: v.boolean(),
      groupNames: v.array(v.string()),
    }),
  ),
  groups: v.array(
    v.object({
      _id: v.id("groups"),
      name: v.string(),
      universityName: v.optional(localizedTextValidator),
      via: groupJoinViaValidator,
      joinedAt: v.number(),
      archived: v.boolean(),
    }),
  ),
  attempts: v.array(
    v.object({
      _id: v.id("attempts"),
      assessmentId: v.id("assessments"),
      assessmentTitle: v.string(),
      kind: assessmentKindValidator,
      courseId: v.id("courses"),
      courseTitle: v.string(),
      number: v.number(),
      status: attemptStatusValidator,
      startedAt: v.number(),
      submittedAt: v.optional(v.number()),
      score: v.optional(v.number()),
      maxScore: v.number(),
      percent: v.optional(v.number()),
      needsGrading: v.boolean(),
      autoSubmitted: v.boolean(),
      graded: v.boolean(),
      integrity: integrityColorValidator,
    }),
  ),
  stats: v.object({
    attempts: v.number(),
    submitted: v.number(),
    inProgress: v.number(),
    needsGrading: v.number(),
    /** Over submitted attempts with a score. */
    averagePercent: v.optional(v.number()),
    bestPercent: v.optional(v.number()),
    /** Attempts whose integrity counters turned red. */
    flagged: v.number(),
  }),
});

function percentOf(score: number | undefined, maxScore: number): number | undefined {
  return score === undefined || maxScore <= 0 ? undefined : Math.round((score / maxScore) * 100);
}

/** The student membership the caller may see, or NOT_FOUND. */
async function requireCoveredStudent(ctx: QueryCtx, scope: AdminScope, userId: Id<"users">) {
  const user = await ctx.db.get("users", userId);
  const membership =
    user === null ? undefined : (await getMemberships(ctx, userId)).find((m) => m.role === "student");
  if (user === null || user.deletedAt !== undefined || membership === undefined || !covers(scope, membership.universityId)) {
    throw appError("NOT_FOUND", "Student not found.");
  }
  return { user, membership };
}

export async function getStudent(ctx: QueryCtx, scope: AdminScope, userId: Id<"users">) {
  const { membership } = await requireCoveredStudent(ctx, scope, userId);
  const lookup = new Lookup(ctx);
  const profile = (await toStudentRow(ctx, lookup, membership))!;

  const enrollments = [];
  for (const row of await ctx.db
    .query("enrollments")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .take(PER_USER_CAP)) {
    const course = await lookup.course(row.courseId);
    if (course === null) continue;
    const groupNames = [];
    for (const groupId of row.groupIds ?? []) {
      const group = await lookup.group(groupId);
      if (group !== null) groupNames.push(group.name);
    }
    enrollments.push({
      _id: row._id,
      courseId: course._id,
      courseTitle: course.title,
      courseStatus: course.status,
      status: row.status,
      enrolledAt: row.enrolledAt,
      viaCode: row.viaCode ?? row.groupIds === undefined,
      groupNames,
    });
  }
  enrollments.sort((a, b) => b.enrolledAt - a.enrolledAt);

  const groups = [];
  for (const row of await ctx.db
    .query("groupMembers")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .take(PER_USER_CAP)) {
    const group = await lookup.group(row.groupId);
    if (group === null) continue;
    groups.push({
      _id: group._id,
      name: group.name,
      universityName: (await lookup.university(group.universityId))?.name,
      via: row.via,
      joinedAt: row.joinedAt,
      archived: group.archivedAt !== undefined,
    });
  }

  const attempts = [];
  const stats = { attempts: 0, submitted: 0, inProgress: 0, needsGrading: 0, flagged: 0 };
  const percents: number[] = [];
  for (const attempt of await ctx.db
    .query("attempts")
    .withIndex("by_userId_and_assessmentId", (q) => q.eq("userId", userId))
    .order("desc")
    .take(300)) {
    const assessment = await ctx.db.get("assessments", attempt.assessmentId);
    const course = await lookup.course(attempt.courseId);
    if (assessment === null || course === null) continue;
    const score = attempt.manualScore ?? attempt.score;
    const percent = attempt.status === "submitted" ? percentOf(score, attempt.maxScore) : undefined;
    const integrity = integrityColor(integrityScore(attempt.integrity));
    stats.attempts++;
    if (attempt.status === "submitted") stats.submitted++;
    else stats.inProgress++;
    if (attempt.needsGrading) stats.needsGrading++;
    if (integrity === "red") stats.flagged++;
    if (percent !== undefined) percents.push(percent);
    attempts.push({
      _id: attempt._id,
      assessmentId: assessment._id,
      assessmentTitle: assessment.title,
      kind: assessment.kind,
      courseId: course._id,
      courseTitle: course.title,
      number: attempt.number,
      status: attempt.status,
      startedAt: attempt.startedAt,
      submittedAt: attempt.submittedAt,
      score,
      maxScore: attempt.maxScore,
      percent,
      needsGrading: attempt.needsGrading ?? false,
      autoSubmitted: attempt.autoSubmitted ?? false,
      graded: attempt.gradedAt !== undefined,
      integrity,
    });
  }
  attempts.sort((a, b) => b.startedAt - a.startedAt);

  return {
    profile,
    enrollments,
    groups,
    attempts,
    stats: {
      ...stats,
      averagePercent:
        percents.length === 0 ? undefined : Math.round(percents.reduce((a, b) => a + b, 0) / percents.length),
      bestPercent: percents.length === 0 ? undefined : Math.max(...percents),
    },
  };
}

/** Takes a student out of a course, or lets them back in (as if they had typed the code). */
export async function setEnrollmentStatus(
  ctx: MutationCtx,
  scope: AdminScope,
  enrollmentId: Id<"enrollments">,
  status: "active" | "removed",
) {
  const row = await ctx.db.get("enrollments", enrollmentId);
  const course = row === null ? null : await ctx.db.get("courses", row.courseId);
  if (row === null || course === null || !covers(scope, course.universityId)) {
    throw appError("NOT_FOUND", "Enrollment not found.");
  }
  if (row.status === status) {
    return;
  }
  // Letting someone back in needs a way in on the row; the admin's decision counts as the code.
  const viaCode = status === "active" && (row.groupIds ?? []).length === 0 ? true : row.viaCode;
  await ctx.db.patch("enrollments", enrollmentId, { status, viaCode });
  const student = await ctx.db.get("users", row.userId);
  await logAudit(ctx, actorOf(scope), {
    action: `enrollment.${status}`,
    targetTable: "enrollments",
    targetId: enrollmentId,
    courseId: course._id,
    summary:
      status === "active"
        ? `Let ${displayName(student)} back into "${course.title}"`
        : `Removed ${displayName(student)} from "${course.title}"`,
  });
}

/**
 * A student's profile, as an admin sets it: the university (any active one for
 * the super admin, their own for a university admin, or none), faculty, group,
 * year and student number. With a university the faculty, group and year are
 * required, as at onboarding.
 */
export async function updateStudentProfile(
  ctx: MutationCtx,
  scope: AdminScope,
  args: {
    userId: Id<"users">;
    universityId: Id<"universities"> | null;
    faculty?: string;
    group?: string;
    year?: number;
    studentNumber?: string;
  },
) {
  const { user, membership } = await requireCoveredStudent(ctx, scope, args.userId);
  let universityName = "no university";
  let profile: Partial<Doc<"memberships">> = {
    universityId: undefined,
    faculty: undefined,
    group: undefined,
    year: undefined,
    studentNumber: undefined,
  };
  if (args.universityId !== null) {
    const university = await ctx.db.get("universities", args.universityId);
    if (university === null || university.status !== "active") {
      throw appError("NOT_FOUND", "That university isn't available.");
    }
    if (!covers(scope, university._id)) {
      throw appError("FORBIDDEN", "You can't move a student to a university you don't administer.");
    }
    universityName = university.name.en;
    const year = args.year ?? 0;
    if (!Number.isInteger(year) || year < 1 || year > 8) {
      throw appError("INVALID_INPUT", "Year must be a whole number from 1 to 8.");
    }
    profile = {
      universityId: university._id,
      faculty: requireText(args.faculty ?? "", "Faculty", 120),
      group: requireText(args.group ?? "", "Group", 40),
      year,
      studentNumber: optionalText(args.studentNumber, "Student ID", 40),
    };
  } else if (!scope.isSuperAdmin) {
    throw appError("FORBIDDEN", "Only the platform admin can take a student out of every university.");
  }
  await ctx.db.patch("memberships", membership._id, profile);
  await logAudit(ctx, actorOf(scope), {
    action: "student.profile",
    targetTable: "memberships",
    targetId: membership._id,
    summary: `Set ${displayName(user)}'s profile: ${universityName}${profile.faculty ? `, ${profile.faculty}, ${profile.group}, year ${profile.year}` : ""}`,
  });
}

// --- Staff -------------------------------------------------------------------------------

export const staffRoleLineValidator = v.object({
  membershipId: v.id("memberships"),
  role: roleValidator,
  universityId: v.optional(v.id("universities")),
  universityName: v.optional(localizedTextValidator),
});

export const staffRowValidator = v.object({
  userId: v.id("users"),
  name: v.string(),
  email: v.string(),
  avatarUrl: v.optional(v.string()),
  locale: localeValidator,
  joinedAt: v.number(),
  /** Every role they hold (students never appear here). */
  roles: v.array(staffRoleLineValidator),
  ownedCourses: v.number(),
  assistantCourses: v.number(),
  groups: v.number(),
  /** Their last recorded change (audit log), if any. */
  lastActiveAt: v.optional(v.number()),
  emailOff: emailOffValidator,
});

type StaffRow = typeof staffRowValidator.type;

async function toStaffRow(
  ctx: QueryCtx,
  lookup: Lookup,
  user: Doc<"users">,
  memberships: Doc<"memberships">[],
): Promise<StaffRow> {
  const roles = [];
  for (const membership of memberships) {
    if (!isStaffRole(membership.role)) continue;
    roles.push({
      membershipId: membership._id,
      role: membership.role,
      universityId: membership.universityId,
      universityName: (await lookup.university(membership.universityId))?.name,
    });
  }
  const seats = await ctx.db
    .query("courseStaff")
    .withIndex("by_userId", (q) => q.eq("userId", user._id))
    .take(PER_USER_CAP);
  const groups = await ctx.db
    .query("groupLecturers")
    .withIndex("by_userId", (q) => q.eq("userId", user._id))
    .take(PER_USER_CAP);
  const last = await ctx.db
    .query("auditLog")
    .withIndex("by_actorId", (q) => q.eq("actorId", user._id))
    .order("desc")
    .first();
  return {
    userId: user._id,
    name: nameOf(user),
    email: user.email,
    avatarUrl: user.avatarUrl,
    locale: user.locale,
    joinedAt: user._creationTime,
    roles,
    ownedCourses: seats.filter((seat) => seat.role === "owner").length,
    assistantCourses: seats.filter((seat) => seat.role === "assistant").length,
    groups: groups.length,
    lastActiveAt: last?.at,
    emailOff: emailOffOf(user),
  };
}

export const staffRoleFilterValidator = v.optional(
  v.union(v.literal("lecturer"), v.literal("uni_admin"), v.literal("super_admin")),
);
type StaffRoleFilter = "lecturer" | "uni_admin" | "super_admin" | undefined;

/** Staff membership rows inside the coverage: lecturers and university admins, plus super admins when everything is covered. */
async function staffMembershipsIn(ctx: QueryCtx, covered: Coverage, role: StaffRoleFilter) {
  const roles: Role[] =
    role !== undefined ? [role] : covered === null ? ["lecturer", "uni_admin", "super_admin"] : ["lecturer", "uni_admin"];
  const rows: Doc<"memberships">[] = [];
  for (const r of roles) {
    if (covered === null) {
      rows.push(
        ...(await ctx.db
          .query("memberships")
          .withIndex("by_role_and_universityId", (q) => q.eq("role", r))
          .take(STAFF_CAP)),
      );
    } else {
      if (r === "super_admin") continue;
      for (const universityId of covered) rows.push(...(await membershipsIn(ctx, universityId, r, STAFF_CAP)));
    }
  }
  return rows;
}

/** Everyone with a staff role inside the coverage, once each, by name. Not paginated: staff are few. */
export async function listStaff(ctx: QueryCtx, scope: AdminScope, filter: UniversityFilter, role: StaffRoleFilter) {
  const covered = coverage(scope, filter);
  const lookup = new Lookup(ctx);
  const seen = new Set<Id<"users">>();
  const out: StaffRow[] = [];
  for (const membership of await staffMembershipsIn(ctx, covered, role)) {
    if (seen.has(membership.userId)) continue;
    seen.add(membership.userId);
    const user = await lookup.user(membership.userId);
    if (user === null || user.deletedAt !== undefined) continue;
    out.push(await toStaffRow(ctx, lookup, user, await getMemberships(ctx, user._id)));
  }
  out.sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
  return out;
}

export async function searchStaff(ctx: QueryCtx, scope: AdminScope, filter: UniversityFilter, query: string) {
  const covered = coverage(scope, filter);
  const lookup = new Lookup(ctx);
  const out: StaffRow[] = [];
  for (const user of await usersByEmailPrefix(ctx, query)) {
    const memberships = await getMemberships(ctx, user._id);
    const inReach = memberships.some(
      (m) => (m.role === "lecturer" || m.role === "uni_admin") && inCoverage(covered, m.universityId),
    );
    if (!inReach && !(covered === null && isSuperAdmin(memberships))) continue;
    out.push(await toStaffRow(ctx, lookup, user, memberships));
  }
  return out;
}

export const staffDetailValidator = v.object({
  profile: staffRowValidator,
  courses: v.array(
    v.object({
      _id: v.id("courses"),
      title: v.string(),
      status: courseStatusValidator,
      universityName: v.optional(localizedTextValidator),
      role: courseStaffRoleValidator,
      students: v.number(),
      assessments: statusTrioValidator,
      updatedAt: v.number(),
    }),
  ),
  groups: v.array(
    v.object({
      _id: v.id("groups"),
      name: v.string(),
      universityName: v.optional(localizedTextValidator),
      members: v.number(),
      archived: v.boolean(),
      joinedAt: v.number(),
    }),
  ),
  activity: v.array(auditLineValidator),
});

/** A staff member the caller may see: someone with a role inside the coverage. */
async function requireCoveredStaff(ctx: QueryCtx, scope: AdminScope, userId: Id<"users">) {
  const user = await ctx.db.get("users", userId);
  const memberships = user === null ? [] : await getMemberships(ctx, userId);
  const visible =
    memberships.some((m) => (m.role === "lecturer" || m.role === "uni_admin") && covers(scope, m.universityId)) ||
    (scope.isSuperAdmin && isSuperAdmin(memberships));
  if (user === null || user.deletedAt !== undefined || !visible) {
    throw appError("NOT_FOUND", "Staff member not found.");
  }
  return { user, memberships };
}

async function memberCountOf(ctx: QueryCtx, group: Doc<"groups">): Promise<number> {
  if (group.memberCount !== undefined) return group.memberCount;
  const rows = await ctx.db
    .query("groupMembers")
    .withIndex("by_groupId", (q) => q.eq("groupId", group._id))
    .take(501);
  return rows.length;
}

export async function getStaffMember(ctx: QueryCtx, scope: AdminScope, userId: Id<"users">) {
  const { user, memberships } = await requireCoveredStaff(ctx, scope, userId);
  const lookup = new Lookup(ctx);
  const profile = await toStaffRow(ctx, lookup, user, memberships);

  const courses = [];
  for (const seat of await ctx.db
    .query("courseStaff")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .take(PER_USER_CAP)) {
    const course = await lookup.course(seat.courseId);
    // A university admin sees the courses of their university; the super admin all of them.
    if (course === null || !covers(scope, course.universityId)) continue;
    courses.push({
      _id: course._id,
      title: course.title,
      status: course.status,
      universityName: (await lookup.university(course.universityId))?.name,
      role: seat.role,
      students: await activeStudentsOf(ctx, course._id),
      assessments: statusCounts(await assessmentsOf(ctx, course._id), STATUSES),
      updatedAt: course.updatedAt,
    });
  }
  courses.sort((a, b) => b.updatedAt - a.updatedAt);

  const groups = [];
  for (const row of await ctx.db
    .query("groupLecturers")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .take(PER_USER_CAP)) {
    const group = await lookup.group(row.groupId);
    if (group === null || !covers(scope, group.universityId)) continue;
    groups.push({
      _id: group._id,
      name: group.name,
      universityName: (await lookup.university(group.universityId))?.name,
      members: await memberCountOf(ctx, group),
      archived: group.archivedAt !== undefined,
      joinedAt: row.joinedAt,
    });
  }

  const activity = [];
  if (scope.isSuperAdmin) {
    for (const row of await ctx.db
      .query("auditLog")
      .withIndex("by_actorId", (q) => q.eq("actorId", userId))
      .order("desc")
      .take(20)) {
      activity.push(await toAuditLine(ctx, lookup, row));
    }
  }
  return { profile, courses, groups, activity };
}

/**
 * Gives someone a staff role they don't have yet: a lecturer or university
 * admin at a university (the super admin may also make an independent
 * lecturer, with no university). A university admin may only add lecturers to
 * their own university. Student accounts stay students; the super admin's own
 * account is the one exception, as everywhere.
 */
export async function addStaffRole(
  ctx: MutationCtx,
  scope: AdminScope,
  args: { userId: Id<"users">; role: "lecturer" | "uni_admin"; universityId?: Id<"universities"> },
) {
  const user = await ctx.db.get("users", args.userId);
  if (user === null || user.deletedAt !== undefined) {
    throw appError("NOT_FOUND", "That account no longer exists.");
  }
  if (args.role === "uni_admin" && args.universityId === undefined) {
    throw appError("INVALID_INPUT", "A university admin needs a university.");
  }
  if (!scope.isSuperAdmin) {
    if (args.role !== "lecturer" || args.universityId === undefined || !covers(scope, args.universityId)) {
      throw appError("FORBIDDEN", "University admins can add lecturers to their own university only.");
    }
  }
  let universityName = "no university (independent teacher)";
  if (args.universityId !== undefined) {
    const university = await ctx.db.get("universities", args.universityId);
    if (university === null || university.status !== "active") {
      throw appError("NOT_FOUND", "That university isn't available.");
    }
    universityName = university.name.en;
  }
  const memberships = await getMemberships(ctx, user._id);
  if (memberships.some((m) => m.role === "student") && !isSuperAdmin(memberships)) {
    throw appError("CONFLICT", "Student accounts stay students. Invite another email address to make them staff.");
  }
  if (memberships.some((m) => m.role === args.role && m.universityId === args.universityId)) {
    return;
  }
  await ctx.db.insert("memberships", { userId: user._id, role: args.role, universityId: args.universityId });
  await logAudit(ctx, actorOf(scope), {
    action: "people.addRole",
    targetTable: "users",
    targetId: user._id,
    summary: `Made ${displayName(user)} a ${args.role === "lecturer" ? "lecturer" : "university admin"} at ${universityName}`,
  });
}

// --- Courses -----------------------------------------------------------------------------

export const courseRowValidator = v.object({
  _id: v.id("courses"),
  _creationTime: v.number(),
  title: v.string(),
  description: v.optional(v.string()),
  semester: v.optional(v.string()),
  locale: localeValidator,
  status: courseStatusValidator,
  joinCode: v.string(),
  joinEnabled: v.boolean(),
  universityId: v.optional(v.id("universities")),
  universityName: v.optional(localizedTextValidator),
  ownerId: v.id("users"),
  ownerName: v.string(),
  ownerEmail: v.optional(v.string()),
  students: v.number(),
  assessments: statusTrioValidator,
  createdVia: viaValidator,
  updatedAt: v.number(),
});

type CourseRow = typeof courseRowValidator.type;

async function toCourseRow(ctx: QueryCtx, lookup: Lookup, course: Doc<"courses">): Promise<CourseRow> {
  const owner = await lookup.user(course.ownerId);
  return {
    _id: course._id,
    _creationTime: course._creationTime,
    title: course.title,
    description: course.description,
    semester: course.semester,
    locale: course.locale,
    status: course.status,
    joinCode: course.joinCode,
    joinEnabled: course.joinEnabled,
    universityId: course.universityId,
    universityName: (await lookup.university(course.universityId))?.name,
    ownerId: course.ownerId,
    ownerName: displayName(owner),
    ownerEmail: owner === null || owner.deletedAt !== undefined ? undefined : owner.email,
    students: await activeStudentsOf(ctx, course._id),
    assessments: statusCounts(await assessmentsOf(ctx, course._id), STATUSES),
    createdVia: course.createdVia,
    updatedAt: course.updatedAt,
  };
}

type CourseStatusFilter = "draft" | "published" | "archived" | undefined;

/** Courses inside the coverage, newest first, a page at a time; optionally one status. */
export async function listCourses(
  ctx: QueryCtx,
  scope: AdminScope,
  filter: UniversityFilter,
  status: CourseStatusFilter,
  paginationOpts: PaginationOptions,
): Promise<PaginationResult<CourseRow>> {
  const where = singleCoverage(scope, filter);
  const ordered = where.all
    ? status === undefined
      ? ctx.db.query("courses").order("desc")
      : ctx.db
          .query("courses")
          .withIndex("by_status", (q) => q.eq("status", status))
          .order("desc")
    : status === undefined
      ? ctx.db
          .query("courses")
          .withIndex("by_universityId", (q) => q.eq("universityId", where.universityId))
          .order("desc")
      : ctx.db
          .query("courses")
          .withIndex("by_universityId_and_status", (q) => q.eq("universityId", where.universityId).eq("status", status))
          .order("desc");
  const result = await ordered.paginate(paginationOpts);
  const lookup = new Lookup(ctx);
  const page: CourseRow[] = [];
  for (const course of result.page) {
    page.push(await toCourseRow(ctx, lookup, course));
  }
  return { ...result, page };
}

/** Courses inside the coverage whose title contains the text, or whose join code it is (the newest thousand are searched). */
export async function searchCourses(ctx: QueryCtx, scope: AdminScope, filter: UniversityFilter, query: string) {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];
  const lookup = new Lookup(ctx);
  const out: CourseRow[] = [];
  for (const course of await coursesIn(ctx, coverage(scope, filter))) {
    if (out.length >= SEARCH_CAP) break;
    if (course.title.toLowerCase().includes(needle) || course.joinCode.toLowerCase() === needle) {
      out.push(await toCourseRow(ctx, lookup, course));
    }
  }
  return out;
}

export const courseDetailValidator = v.object({
  course: courseRowValidator,
  staff: v.array(
    v.object({
      userId: v.id("users"),
      name: v.string(),
      email: v.optional(v.string()),
      role: courseStaffRoleValidator,
    }),
  ),
  assessments: v.array(
    v.object({
      _id: v.id("assessments"),
      title: v.string(),
      kind: assessmentKindValidator,
      status: assessmentStatusValidator,
      questionCount: v.number(),
      totalPoints: v.number(),
      opensAt: v.optional(v.number()),
      closesAt: v.optional(v.number()),
      inProgress: v.number(),
      submitted: v.number(),
      publishedAt: v.optional(v.number()),
      updatedAt: v.number(),
    }),
  ),
  groups: v.array(v.object({ _id: v.id("groups"), name: v.string(), members: v.number() })),
  enrollments: v.object({ active: v.number(), removed: v.number() }),
});

async function requireCoveredCourse(ctx: QueryCtx, scope: AdminScope, courseId: Id<"courses">) {
  const course = await ctx.db.get("courses", courseId);
  if (course === null || !covers(scope, course.universityId)) {
    throw appError("NOT_FOUND", "Course not found.");
  }
  return course;
}

export async function getCourse(ctx: QueryCtx, scope: AdminScope, courseId: Id<"courses">) {
  const course = await requireCoveredCourse(ctx, scope, courseId);
  const lookup = new Lookup(ctx);
  const staff = [];
  for (const seat of await ctx.db
    .query("courseStaff")
    .withIndex("by_courseId", (q) => q.eq("courseId", courseId))
    .take(100)) {
    const user = await lookup.user(seat.userId);
    staff.push({
      userId: seat.userId,
      name: displayName(user),
      email: user === null || user.deletedAt !== undefined ? undefined : user.email,
      role: seat.role,
    });
  }
  const assessments = [];
  for (const assessment of await assessmentsOf(ctx, courseId)) {
    assessments.push({
      _id: assessment._id,
      title: assessment.title,
      kind: assessment.kind,
      status: assessment.status,
      questionCount: assessment.questionCount,
      totalPoints: assessment.totalPoints,
      opensAt: assessment.settings.opensAt,
      closesAt: assessment.settings.closesAt,
      inProgress: await attemptsOf(ctx, assessment._id, "in_progress"),
      submitted: await attemptsOf(ctx, assessment._id, "submitted"),
      publishedAt: assessment.publishedAt,
      updatedAt: assessment.updatedAt,
    });
  }
  assessments.sort((a, b) => b.updatedAt - a.updatedAt);
  const groups = [];
  for (const link of await ctx.db
    .query("courseGroups")
    .withIndex("by_courseId", (q) => q.eq("courseId", courseId))
    .take(100)) {
    const group = await lookup.group(link.groupId);
    if (group !== null) groups.push({ _id: group._id, name: group.name, members: await memberCountOf(ctx, group) });
  }
  const enrollmentRows = await ctx.db
    .query("enrollments")
    .withIndex("by_courseId", (q) => q.eq("courseId", courseId))
    .take(2000);
  return {
    course: await toCourseRow(ctx, lookup, course),
    staff,
    assessments,
    groups,
    enrollments: {
      active: enrollmentRows.filter((row) => row.status === "active").length,
      removed: enrollmentRows.filter((row) => row.status === "removed").length,
    },
  };
}

/**
 * Hands a course to another staff member: they become its owner (the one who
 * edits it); the previous owner keeps a seat as an assistant so nothing of
 * theirs vanishes mid-term. The new owner is found by email and must be staff.
 */
export async function transferCourse(
  ctx: MutationCtx,
  scope: AdminScope,
  courseId: Id<"courses">,
  newOwnerEmail: string,
) {
  const course = await requireCoveredCourse(ctx, scope, courseId);
  const email = normalizeEmail(newOwnerEmail);
  const candidates = (
    await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .take(2)
  ).filter((user) => user.deletedAt === undefined);
  if (candidates.length !== 1) {
    throw appError("NOT_FOUND", `No account with the email ${email}.`);
  }
  const newOwner = candidates[0];
  const memberships = await getMemberships(ctx, newOwner._id);
  if (!memberships.some((m) => isStaffRole(m.role))) {
    throw appError("CONFLICT", `${email} isn't staff. Invite them as a lecturer first.`);
  }
  if (newOwner._id === course.ownerId) {
    return;
  }
  const seats = await ctx.db
    .query("courseStaff")
    .withIndex("by_courseId", (q) => q.eq("courseId", courseId))
    .take(100);
  for (const seat of seats) {
    if (seat.userId === course.ownerId && seat.role === "owner") {
      await ctx.db.patch("courseStaff", seat._id, { role: "assistant" });
    }
  }
  const existing = seats.find((seat) => seat.userId === newOwner._id);
  if (existing === undefined) {
    await ctx.db.insert("courseStaff", { courseId, userId: newOwner._id, role: "owner" });
  } else if (existing.role !== "owner") {
    await ctx.db.patch("courseStaff", existing._id, { role: "owner" });
  }
  await ctx.db.patch("courses", courseId, { ownerId: newOwner._id, updatedAt: Date.now() });
  const previous = await ctx.db.get("users", course.ownerId);
  await logAudit(ctx, actorOf(scope), {
    action: "course.transfer",
    targetTable: "courses",
    targetId: courseId,
    courseId,
    summary: `Handed "${course.title}" from ${displayName(previous)} to ${displayName(newOwner)}`,
  });
}

// --- Groups ------------------------------------------------------------------------------

export const groupRowValidator = v.object({
  _id: v.id("groups"),
  _creationTime: v.number(),
  name: v.string(),
  description: v.optional(v.string()),
  universityId: v.optional(v.id("universities")),
  universityName: v.optional(localizedTextValidator),
  /** Who made it: an admin, or the teacher of a private group. */
  ownerName: v.string(),
  archived: v.boolean(),
  inviteEnabled: v.boolean(),
  members: v.number(),
  pendingInvites: v.number(),
  lecturers: v.number(),
  courses: v.number(),
  updatedAt: v.number(),
});

/** Every group inside the coverage, archived ones too, by university then name. Not paginated: a university has at most a few hundred. */
export async function listGroups(ctx: QueryCtx, scope: AdminScope, filter: UniversityFilter) {
  const lookup = new Lookup(ctx);
  const out = [];
  for (const group of await groupsIn(ctx, coverage(scope, filter))) {
    const lecturers = await ctx.db
      .query("groupLecturers")
      .withIndex("by_groupId_and_userId", (q) => q.eq("groupId", group._id))
      .take(51);
    const links = await ctx.db
      .query("courseGroups")
      .withIndex("by_groupId", (q) => q.eq("groupId", group._id))
      .take(51);
    const university = await lookup.university(group.universityId);
    out.push({
      _id: group._id,
      _creationTime: group._creationTime,
      name: group.name,
      description: group.description,
      universityId: group.universityId,
      universityName: university?.name,
      ownerName: displayName(await lookup.user(group.ownerId)),
      archived: group.archivedAt !== undefined,
      inviteEnabled: group.inviteEnabled,
      members: await memberCountOf(ctx, group),
      pendingInvites: group.pendingInvites ?? 0,
      lecturers: lecturers.length,
      courses: links.length,
      updatedAt: group.updatedAt,
    });
  }
  out.sort(
    (a, b) =>
      (a.universityName?.en ?? "").localeCompare(b.universityName?.en ?? "") || a.name.localeCompare(b.name),
  );
  return out;
}

// --- Activity ----------------------------------------------------------------------------

/** The whole audit log, newest first, optionally one kind of record. Super admin only. */
export async function listActivity(
  ctx: QueryCtx,
  targetTable: string | undefined,
  paginationOpts: PaginationOptions,
): Promise<PaginationResult<AuditLine>> {
  const ordered =
    targetTable === undefined
      ? ctx.db.query("auditLog").order("desc")
      : ctx.db
          .query("auditLog")
          .withIndex("by_targetTable", (q) => q.eq("targetTable", targetTable))
          .order("desc");
  const result = await ordered.paginate(paginationOpts);
  const lookup = new Lookup(ctx);
  const page = [];
  for (const row of result.page) {
    page.push(await toAuditLine(ctx, lookup, row));
  }
  return { ...result, page };
}

// --- System ------------------------------------------------------------------------------

/** How close to a deadline a deploy is refused. */
const GUARD_WINDOW_MS = 2 * 60 * 60 * 1000;

/**
 * Whether students are in the middle of timed work right now, or work closes
 * within the next two hours with attempts still open. A deploy restarts the
 * apps' bundles; it must not land in an exam (scripts/predeploy.mjs).
 */
export async function deployGuardStatus(ctx: QueryCtx, now: number): Promise<{ busy: boolean; reason: string }> {
  const timed = await ctx.db
    .query("attempts")
    .withIndex("by_status_and_deadlineAt", (q) =>
      q.eq("status", "in_progress").gte("deadlineAt", now - GUARD_WINDOW_MS).lte("deadlineAt", now + GUARD_WINDOW_MS),
    )
    .first();
  if (timed !== null) {
    return { busy: true, reason: "a timed attempt is in progress or ends within two hours" };
  }
  const closing = await ctx.db
    .query("assessments")
    .withIndex("by_status_and_closesAt", (q) =>
      q
        .eq("status", "published")
        .gte("settings.closesAt", now - GUARD_WINDOW_MS)
        .lte("settings.closesAt", now + GUARD_WINDOW_MS),
    )
    .take(50);
  for (const assessment of closing) {
    const open = await ctx.db
      .query("attempts")
      .withIndex("by_assessmentId_and_status", (q) => q.eq("assessmentId", assessment._id).eq("status", "in_progress"))
      .first();
    if (open !== null) {
      return { busy: true, reason: `“${assessment.title}” closes within two hours and students are still working on it` };
    }
  }
  return { busy: false, reason: "no exam is running or about to close" };
}

export const systemValidator = v.object({
  deploy: v.object({ busy: v.boolean(), reason: v.string() }),
  email: v.object({
    /** RESEND_API_KEY is set on this deployment. */
    configured: v.boolean(),
    suppressions: v.array(
      v.object({
        _id: v.id("emailSuppressions"),
        email: v.string(),
        status: v.union(v.literal("bounced"), v.literal("complained")),
        at: v.number(),
        /** The account with that address, if there is one. */
        userId: v.optional(v.id("users")),
        name: v.optional(v.string()),
      }),
    ),
  }),
  migration: v.object({
    /** Legacy materials rows still waiting to become weeks (migrations.ts). */
    materialsLeft: v.number(),
  }),
  attemptsInProgress: v.number(),
  scheduledJobs: v.array(v.object({ name: v.string(), every: v.string(), does: v.string() })),
});

/** Mirrors crons.ts, for the System page. */
const SCHEDULED_JOBS = [
  { name: "auto-submit closed tasks", every: "1 minute", does: "Submits work still open when its task closed, as it stands." },
  { name: "deadline reminders", every: "5 minutes", does: "“Due tomorrow” and “due in an hour” notifications." },
  { name: "delete old conversations", every: "24 hours", does: "Removes conversations resolved more than a year ago." },
  { name: "move materials into weeks", every: "1 hour", does: "Finishes the legacy materials → weeks migration." },
  { name: "clean up sent emails", every: "24 hours", does: "Drops delivery records older than a week." },
];

export async function getSystem(ctx: QueryCtx, now: number) {
  const suppressions = [];
  for (const row of await ctx.db.query("emailSuppressions").order("desc").take(200)) {
    // .at(): the row may not exist, and an index would be narrowed to "it does".
    const user = (
      await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", row.email))
        .take(1)
    ).at(0);
    suppressions.push({
      _id: row._id,
      email: row.email,
      status: row.status,
      at: row.at,
      userId: user?._id,
      name: user === undefined ? undefined : nameOf(user) || undefined,
    });
  }
  const materialsLeft = (await ctx.db.query("materials").take(1000)).length;
  const inProgress = await ctx.db
    .query("attempts")
    .withIndex("by_status_and_deadlineAt", (q) => q.eq("status", "in_progress"))
    .take(2000);
  return {
    deploy: await deployGuardStatus(ctx, now),
    email: { configured: Boolean(process.env.RESEND_API_KEY), suppressions },
    migration: { materialsLeft },
    attemptsInProgress: inProgress.length,
    scheduledJobs: SCHEDULED_JOBS,
  };
}

/** Lets Kalami email an address again after a bounce or complaint, and clears the mark on the account. */
export async function clearEmailSuppression(ctx: MutationCtx, scope: AdminScope, rawEmail: string) {
  const email = normalizeEmail(rawEmail);
  for (const row of await ctx.db
    .query("emailSuppressions")
    .withIndex("by_email", (q) => q.eq("email", email))
    .take(10)) {
    await ctx.db.delete("emailSuppressions", row._id);
  }
  for (const user of await ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", email))
    .take(5)) {
    if (user.emailStatus !== undefined) {
      await ctx.db.patch("users", user._id, { emailStatus: undefined });
    }
  }
  await logAudit(ctx, actorOf(scope), {
    action: "email.allow",
    targetTable: "emailSuppressions",
    targetId: email,
    summary: `Allowed email to ${email} again`,
  });
}
