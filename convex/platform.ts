import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { broadcastAudienceValidator, broadcastChannelsValidator, courseStatusValidator, universityStatusValidator } from "./lib/validators";
import {
  audiencePreviewValidator,
  broadcastRowValidator,
  createBroadcast,
  deliveryRowValidator,
  listBroadcasts,
  listRecipients,
  personHitValidator,
  previewAudience,
  searchPeople,
} from "./model/broadcasts";
import {
  addStaffRole as addStaffRoleModel,
  auditLineValidator,
  clearEmailSuppression as clearEmailSuppressionModel,
  courseDetailValidator,
  courseRowValidator,
  getCourse,
  getOverview,
  getStaffMember,
  getStudent,
  getSystem,
  groupRowValidator,
  listActivity,
  listCourses,
  listGroups,
  listStaff,
  listStudents,
  listUniversities,
  overviewValidator,
  requireAdminScope,
  requireSuperAdminScope,
  searchCourses,
  searchStaff,
  searchStudents,
  setEnrollmentStatus as setEnrollmentStatusModel,
  staffDetailValidator,
  staffRoleFilterValidator,
  staffRowValidator,
  studentDetailValidator,
  studentRowValidator,
  systemValidator,
  transferCourse as transferCourseModel,
  universityFilterValidator,
  universityRowValidator,
  updateStudentProfile as updateStudentProfileModel,
  updateUniversity as updateUniversityModel,
} from "./model/platform";

// The admin panel (staff app, /admin). The super admin sees the whole platform
// and may filter by university; a university admin sees their own university.
// Everything else the panel does goes through the existing modules: invites,
// people (roles), courses (status, joining, delete), assessments (status),
// groups (archive, link), universities (create). See model/platform.ts.

/** Clients round `now` to the minute so the result caches between calls. */
const nowArg = { now: v.number() };

// --- Overview and universities -----------------------------------------------------------

export const overview = query({
  args: { university: universityFilterValidator, ...nowArg },
  returns: overviewValidator,
  handler: async (ctx, args) => {
    const scope = await requireAdminScope(ctx);
    return await getOverview(ctx, scope, args.university, args.now);
  },
});

export const universities = query({
  args: nowArg,
  returns: v.array(universityRowValidator),
  handler: async (ctx, args) => {
    const scope = await requireAdminScope(ctx);
    return await listUniversities(ctx, scope, args.now);
  },
});

/** Rename, change the slug, or archive/restore a university. Super admin only. */
export const updateUniversity = mutation({
  args: {
    universityId: v.id("universities"),
    nameKa: v.optional(v.string()),
    nameEn: v.optional(v.string()),
    slug: v.optional(v.string()),
    status: v.optional(universityStatusValidator),
  },
  returns: v.null(),
  handler: async (ctx, { universityId, ...patch }) => {
    const scope = await requireSuperAdminScope(ctx);
    await updateUniversityModel(ctx, scope, universityId, patch);
    return null;
  },
});

// --- Students ----------------------------------------------------------------------------

export const students = query({
  args: { university: universityFilterValidator, paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(studentRowValidator),
  handler: async (ctx, args) => {
    const scope = await requireAdminScope(ctx);
    return await listStudents(ctx, scope, args.university, args.paginationOpts);
  },
});

/** Students whose email starts with the query (two characters at least). */
export const findStudents = query({
  args: { university: universityFilterValidator, query: v.string() },
  returns: v.array(studentRowValidator),
  handler: async (ctx, args) => {
    const scope = await requireAdminScope(ctx);
    return await searchStudents(ctx, scope, args.university, args.query);
  },
});

export const student = query({
  args: { userId: v.id("users") },
  returns: studentDetailValidator,
  handler: async (ctx, args) => {
    const scope = await requireAdminScope(ctx);
    return await getStudent(ctx, scope, args.userId);
  },
});

/** Removes a student from a course, or lets them back in. */
export const setEnrollmentStatus = mutation({
  args: { enrollmentId: v.id("enrollments"), status: v.union(v.literal("active"), v.literal("removed")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const scope = await requireAdminScope(ctx);
    await setEnrollmentStatusModel(ctx, scope, args.enrollmentId, args.status);
    return null;
  },
});

/** The student's university and profile, set by an admin. `universityId: null` means no university (super admin only). */
export const updateStudentProfile = mutation({
  args: {
    userId: v.id("users"),
    universityId: v.union(v.id("universities"), v.null()),
    faculty: v.optional(v.string()),
    group: v.optional(v.string()),
    year: v.optional(v.number()),
    studentNumber: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const scope = await requireAdminScope(ctx);
    await updateStudentProfileModel(ctx, scope, args);
    return null;
  },
});

// --- Staff -------------------------------------------------------------------------------

export const staff = query({
  args: { university: universityFilterValidator, role: staffRoleFilterValidator },
  returns: v.array(staffRowValidator),
  handler: async (ctx, args) => {
    const scope = await requireAdminScope(ctx);
    return await listStaff(ctx, scope, args.university, args.role);
  },
});

export const findStaff = query({
  args: { university: universityFilterValidator, query: v.string() },
  returns: v.array(staffRowValidator),
  handler: async (ctx, args) => {
    const scope = await requireAdminScope(ctx);
    return await searchStaff(ctx, scope, args.university, args.query);
  },
});

export const staffMember = query({
  args: { userId: v.id("users") },
  returns: staffDetailValidator,
  handler: async (ctx, args) => {
    const scope = await requireAdminScope(ctx);
    return await getStaffMember(ctx, scope, args.userId);
  },
});

/** Gives an account a staff role it doesn't have yet (people.changeStaffRole changes an existing one). */
export const addStaffRole = mutation({
  args: {
    userId: v.id("users"),
    role: v.union(v.literal("lecturer"), v.literal("uni_admin")),
    universityId: v.optional(v.id("universities")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const scope = await requireAdminScope(ctx);
    await addStaffRoleModel(ctx, scope, args);
    return null;
  },
});

// --- Courses -----------------------------------------------------------------------------

export const courses = query({
  args: {
    university: universityFilterValidator,
    status: v.optional(courseStatusValidator),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(courseRowValidator),
  handler: async (ctx, args) => {
    const scope = await requireAdminScope(ctx);
    return await listCourses(ctx, scope, args.university, args.status, args.paginationOpts);
  },
});

export const findCourses = query({
  args: { university: universityFilterValidator, query: v.string() },
  returns: v.array(courseRowValidator),
  handler: async (ctx, args) => {
    const scope = await requireAdminScope(ctx);
    return await searchCourses(ctx, scope, args.university, args.query);
  },
});

export const course = query({
  args: { courseId: v.id("courses") },
  returns: courseDetailValidator,
  handler: async (ctx, args) => {
    const scope = await requireAdminScope(ctx);
    return await getCourse(ctx, scope, args.courseId);
  },
});

/** Makes another staff member the course's owner; the previous owner stays on as an assistant. */
export const transferCourse = mutation({
  args: { courseId: v.id("courses"), newOwnerEmail: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const scope = await requireAdminScope(ctx);
    await transferCourseModel(ctx, scope, args.courseId, args.newOwnerEmail);
    return null;
  },
});

// --- Groups ------------------------------------------------------------------------------

export const groups = query({
  args: { university: universityFilterValidator },
  returns: v.array(groupRowValidator),
  handler: async (ctx, args) => {
    const scope = await requireAdminScope(ctx);
    return await listGroups(ctx, scope, args.university);
  },
});

// --- Notifications: the notification center (model/broadcasts.ts) --------------------------

/** Anyone within reach whose email starts with the query, for picking recipients one by one. */
export const findPeople = query({
  args: { query: v.string() },
  returns: v.array(personHitValidator),
  handler: async (ctx, args) => {
    const scope = await requireAdminScope(ctx);
    return await searchPeople(ctx, scope, args.query);
  },
});

/** Who a message would reach, before it's sent. */
export const broadcastPreview = query({
  args: { audience: broadcastAudienceValidator, emailEveryone: v.boolean() },
  returns: audiencePreviewValidator,
  handler: async (ctx, args) => {
    const scope = await requireAdminScope(ctx);
    return await previewAudience(ctx, scope, args.audience, args.emailEveryone);
  },
});

/** Sends a message: the bell for students, a push and an email as chosen. Delivered in batches right after. */
export const sendBroadcast = mutation({
  args: {
    title: v.string(),
    body: v.string(),
    link: v.optional(v.string()),
    audience: broadcastAudienceValidator,
    channels: broadcastChannelsValidator,
    emailEveryone: v.boolean(),
  },
  returns: v.id("broadcasts"),
  handler: async (ctx, args) => {
    const scope = await requireAdminScope(ctx);
    return await createBroadcast(ctx, scope, args);
  },
});

/** The newest messages sent: every one for the platform admin, their own for a university admin. */
export const broadcasts = query({
  args: {},
  returns: v.array(broadcastRowValidator),
  handler: async (ctx) => {
    const scope = await requireAdminScope(ctx);
    return await listBroadcasts(ctx, scope);
  },
});

export const broadcastRecipients = query({
  args: { broadcastId: v.id("broadcasts"), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(deliveryRowValidator),
  handler: async (ctx, args) => {
    const scope = await requireAdminScope(ctx);
    return await listRecipients(ctx, scope, args.broadcastId, args.paginationOpts);
  },
});

// --- Activity and system (super admin only) -----------------------------------------------

export const activity = query({
  args: { targetTable: v.optional(v.string()), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(auditLineValidator),
  handler: async (ctx, args) => {
    await requireSuperAdminScope(ctx);
    return await listActivity(ctx, args.targetTable, args.paginationOpts);
  },
});

export const system = query({
  args: nowArg,
  returns: systemValidator,
  handler: async (ctx, args) => {
    await requireSuperAdminScope(ctx);
    return await getSystem(ctx, args.now);
  },
});

/** Lets Kalami email an address again after a bounce or complaint. */
export const clearEmailSuppression = mutation({
  args: { email: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const scope = await requireSuperAdminScope(ctx);
    await clearEmailSuppressionModel(ctx, scope, args.email);
    return null;
  },
});
