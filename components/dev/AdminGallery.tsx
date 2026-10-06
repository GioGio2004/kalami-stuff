"use client";

import type { ReactNode } from "react";
import { ActivityView } from "@/components/admin/panel/ActivityView";
import { AdminScopeContext, type AdminScopeValue } from "@/components/admin/panel/AdminScope";
import { AdminShell } from "@/components/admin/panel/AdminShell";
import { CourseDetailDialog } from "@/components/admin/panel/CourseDetail";
import { CoursesView } from "@/components/admin/panel/CoursesView";
import { GroupsView } from "@/components/admin/panel/GroupsView";
import { OverviewView } from "@/components/admin/panel/OverviewView";
import { StaffDetailDialog } from "@/components/admin/panel/StaffDetail";
import { StaffView } from "@/components/admin/panel/StaffView";
import { StudentDetailDialog } from "@/components/admin/panel/StudentDetail";
import { StudentsView } from "@/components/admin/panel/StudentsView";
import { SystemView } from "@/components/admin/panel/SystemView";
import { BroadcastDetailDialog } from "@/components/admin/panel/BroadcastDetail";
import { NotificationsView } from "@/components/admin/panel/NotificationsView";
import { UniversitiesView } from "@/components/admin/panel/UniversitiesView";
import type {
  AdminCourseDetail,
  AdminUniversity,
  AuditLine,
  CourseRow,
  GroupRow,
  Overview,
  StaffDetail,
  StaffRow,
  StudentDetail,
  StudentRow,
  SystemInfo,
  UniversityRow,
  AudiencePreview,
  BroadcastRow,
  DeliveryRow,
  PersonHit,
} from "@/components/admin/types";
import { CurrentUserContext, type Me } from "@/components/CurrentUserProvider";

// The admin panel's screens with sample data, for the development gallery
// (/dev/ui?view=panel-…). Nothing here reaches the backend.

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
// Fixed, so the server and the browser render the same "12 min ago" (no hydration mismatch).
export const NOW = Date.UTC(2026, 9, 5, 18, 0);

/** A sample id, typed by where it is used. */
const id = <T,>(value: string) => value as unknown as T;

export const gori: AdminUniversity = {
  _id: id("sample_gori"),
  name: { ka: "გორის სახელმწიფო უნივერსიტეტი", en: "Gori State University" },
  slug: "gori-state",
  status: "active",
};
export const tsu: AdminUniversity = {
  _id: id("sample_tsu"),
  name: { ka: "თბილისის სახელმწიფო უნივერსიტეტი", en: "Tbilisi State University" },
  slug: "tsu",
  status: "active",
};
const old: AdminUniversity = {
  _id: id("sample_old"),
  name: { ka: "ძველი კოლეჯი", en: "Old College" },
  slug: "old-college",
  status: "archived",
};

export const superAdminMe: Me = {
  _id: id("sample_owner"),
  email: "owner@kalami.space",
  firstName: "Giorgi",
  lastName: "Khvichia",
  avatarUrl: undefined,
  locale: "en",
  memberships: [{ role: "super_admin", universityId: undefined }],
  isStaff: true,
  isSuperAdmin: true,
  honestyAccepted: false,
  student: null,
  needsOnboarding: false,
  studioIntroSeenAt: NOW - DAY,
};

export const uniAdminMe: Me = {
  ...superAdminMe,
  _id: id("sample_dean"),
  email: "dean@gsu.edu.ge",
  firstName: "Tea",
  lastName: "Todua",
  memberships: [{ role: "uni_admin", universityId: gori._id }],
  isSuperAdmin: false,
};

const fakeAvatar = <span className="grid size-10 place-items-center rounded-full bg-highlighter text-sm font-semibold">GK</span>;

/** A page inside the admin shell, as the given admin, at the given path. */
export function adminPage(children: ReactNode, pathname: string, me: Me = superAdminMe, picked: string = "all") {
  const universities = me.isSuperAdmin ? [gori, tsu, old] : [gori];
  const filter = picked === "all" ? undefined : (picked as AdminScopeValue["filter"]);
  const scope: AdminScopeValue = {
    isSuperAdmin: me.isSuperAdmin,
    universities,
    ready: true,
    filter: me.isSuperAdmin ? filter : gori._id,
    setFilter: () => undefined,
    picked: me.isSuperAdmin ? picked : gori._id,
    label: me.isSuperAdmin ? (filter === undefined ? "Every university" : "Gori State University") : gori.name.en,
  };
  return (
    <CurrentUserContext.Provider value={{ status: "ready", me }}>
      <AdminScopeContext.Provider value={scope}>
        <AdminShell me={me} universities={universities} picked={scope.picked} onPick={() => undefined} avatar={fakeAvatar} pathname={pathname}>
          {children}
        </AdminShell>
      </AdminScopeContext.Provider>
    </CurrentUserContext.Provider>
  );
}

async function pause(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 600));
}

// --- Samples -----------------------------------------------------------------------------

const auditLine = (fields: Partial<AuditLine> & Pick<AuditLine, "summary" | "actorName">): AuditLine => ({
  _id: id(`sample_audit_${fields.summary.length}_${fields.at ?? 0}`),
  at: NOW - 2 * HOUR,
  via: "web",
  client: undefined,
  action: "course.update",
  targetTable: "courses",
  targetId: "sample_course_web",
  courseId: id("sample_course_web"),
  courseTitle: "Web basics",
  actorEmail: "nino.beridze@gsu.edu.ge",
  ...fields,
});

const recent: AuditLine[] = [
  auditLine({ summary: 'Published "CSS selectors"', actorName: "Nino Beridze", action: "assessment.published", targetTable: "assessments", at: NOW - 12 * 60 * 1000 }),
  auditLine({ summary: 'Added 10 questions to "CSS selectors"', actorName: "Nino Beridze", via: "mcp", client: "claude.ai", action: "questions.add", targetTable: "questions", at: NOW - 40 * 60 * 1000 }),
  auditLine({ summary: "Made Levan Abashidze a lecturer at Tbilisi State University", actorName: "Giorgi Khvichia", actorEmail: "owner@kalami.space", action: "people.addRole", targetTable: "users", courseId: undefined, courseTitle: undefined, at: NOW - 3 * HOUR }),
  auditLine({ summary: 'Removed Ana Kapanadze from "Databases"', actorName: "Tea Todua", actorEmail: "dean@gsu.edu.ge", action: "enrollment.removed", targetTable: "enrollments", courseTitle: "Databases", at: NOW - 5 * HOUR }),
  auditLine({ summary: 'Created group "ICT-25-1"', actorName: "Tea Todua", actorEmail: "dean@gsu.edu.ge", action: "group.create", targetTable: "groups", courseId: undefined, courseTitle: undefined, at: NOW - DAY }),
  auditLine({ summary: 'Archived university "Old College"', actorName: "Giorgi Khvichia", actorEmail: "owner@kalami.space", action: "university.archived", targetTable: "universities", courseId: undefined, courseTitle: undefined, at: NOW - 2 * DAY }),
];

const overview: Overview = {
  isSuperAdmin: true,
  universities: [gori, tsu, old].map((u) => ({ _id: u._id, name: u.name, status: u.status })),
  people: { students: 1284, lecturers: 46, uniAdmins: 4, superAdmins: 2, capped: false },
  courses: { draft: 9, published: 31, archived: 12, total: 52 },
  assessments: { draft: 24, published: 143, archived: 38, byKind: { task: 61, quiz: 118, midterm: 14, final: 12 }, approximate: false },
  groups: { active: 38, archived: 11 },
  pendingInvites: 3,
  openTeamConversations: 2,
  live: {
    attemptsInProgress: 27,
    closingSoon: [
      { assessmentId: id("sample_midterm"), title: "Midterm · Web basics", kind: "midterm", courseId: id("sample_course_web"), courseTitle: "Web basics", closesAt: NOW + 50 * 60 * 1000, inProgress: 24 },
      { assessmentId: id("sample_quiz_2"), title: "CSS selectors", kind: "quiz", courseId: id("sample_course_web"), courseTitle: "Web basics", closesAt: NOW + 1.6 * HOUR, inProgress: 3 },
    ],
  },
  recent,
};

const overviewUni: Overview = {
  ...overview,
  isSuperAdmin: false,
  universities: [{ _id: gori._id, name: gori.name, status: "active" }],
  people: { students: 412, lecturers: 17, uniAdmins: 2, superAdmins: undefined, capped: false },
  courses: { draft: 3, published: 12, archived: 4, total: 19 },
  assessments: { draft: 8, published: 51, archived: 10, byKind: { task: 20, quiz: 42, midterm: 4, final: 3 }, approximate: false },
  groups: { active: 14, archived: 3 },
  pendingInvites: 1,
  openTeamConversations: undefined,
  live: { attemptsInProgress: 0, closingSoon: [] },
  recent: [],
};

const universityRows: UniversityRow[] = [
  { _id: gori._id, _creationTime: NOW - 400 * DAY, name: gori.name, slug: gori.slug, status: "active", students: 412, lecturers: 17, admins: 2, courses: 19, publishedCourses: 12, groups: 17, pendingInvites: 1 },
  { _id: tsu._id, _creationTime: NOW - 120 * DAY, name: tsu.name, slug: tsu.slug, status: "active", students: 872, lecturers: 29, admins: 2, courses: 33, publishedCourses: 19, groups: 32, pendingInvites: 2 },
  { _id: old._id, _creationTime: NOW - 700 * DAY, name: old.name, slug: old.slug, status: "archived", students: 0, lecturers: 0, admins: 0, courses: 0, publishedCourses: 0, groups: 0, pendingInvites: 0 },
];

const studentRow = (fields: Partial<StudentRow> & Pick<StudentRow, "name" | "email">): StudentRow => ({
  userId: id(`sample_u_${fields.email}`),
  membershipId: id(`sample_m_${fields.email}`),
  avatarUrl: undefined,
  locale: "ka",
  universityId: gori._id,
  universityName: gori.name,
  faculty: "Informatics",
  group: "ICT-24-1",
  year: 2,
  studentNumber: undefined,
  joinedAt: NOW - 30 * DAY,
  onboarded: true,
  courses: 3,
  groups: 1,
  emailOff: undefined,
  ...fields,
});

const studentRows: StudentRow[] = [
  studentRow({ name: "Ana Kapanadze", email: "ana.k@gmail.com", joinedAt: NOW - 2 * DAY, courses: 4, studentNumber: "S-24-0117" }),
  studentRow({ name: "Giorgi Lomidze", email: "giorgi@school.ge", joinedAt: NOW - 3 * DAY, group: "ICT-24-2", courses: 2, emailOff: "bounced" }),
  studentRow({ name: "", email: "new.student@gmail.com", joinedAt: NOW - 4 * DAY, onboarded: false, universityId: undefined, universityName: undefined, faculty: undefined, group: undefined, year: undefined, courses: 0, groups: 0 }),
  studentRow({ name: "Mariam Tsereteli", email: "mariam.ts@gmail.com", joinedAt: NOW - 9 * DAY, universityId: tsu._id, universityName: tsu.name, faculty: "Business", group: "BA-23-1", year: 3, courses: 5, groups: 2 }),
  studentRow({ name: "Luka Beridze", email: "luka.b@gmail.com", joinedAt: NOW - 20 * DAY, year: 1, courses: 1, emailOff: "opted_out" }),
];

const studentDetail: StudentDetail = {
  profile: studentRows[0],
  enrollments: [
    { _id: id("sample_e1"), courseId: id("sample_course_web"), courseTitle: "Web basics", courseStatus: "published", status: "active", enrolledAt: NOW - 20 * DAY, viaCode: true, groupNames: ["ICT-24-1"] },
    { _id: id("sample_e2"), courseId: id("sample_course_js"), courseTitle: "JavaScript fundamentals", courseStatus: "draft", status: "active", enrolledAt: NOW - 5 * DAY, viaCode: false, groupNames: ["ICT-24-1"] },
    { _id: id("sample_e3"), courseId: id("sample_course_db"), courseTitle: "Databases", courseStatus: "archived", status: "removed", enrolledAt: NOW - 200 * DAY, viaCode: true, groupNames: [] },
  ],
  groups: [{ _id: id("sample_group_a"), name: "ICT-24-1", universityName: gori.name, via: "link", joinedAt: NOW - 20 * DAY, archived: false }],
  attempts: [
    { _id: id("sample_a1"), assessmentId: id("sample_midterm"), assessmentTitle: "Midterm · Web basics", kind: "midterm", courseId: id("sample_course_web"), courseTitle: "Web basics", number: 1, status: "in_progress", startedAt: NOW - 25 * 60 * 1000, submittedAt: undefined, score: undefined, maxScore: 12, percent: undefined, needsGrading: false, autoSubmitted: false, graded: false, integrity: "yellow" },
    { _id: id("sample_a2"), assessmentId: id("sample_quiz_2"), assessmentTitle: "CSS selectors", kind: "quiz", courseId: id("sample_course_web"), courseTitle: "Web basics", number: 1, status: "submitted", startedAt: NOW - 2 * DAY, submittedAt: NOW - 2 * DAY + 20 * 60 * 1000, score: 9, maxScore: 10, percent: 90, needsGrading: false, autoSubmitted: false, graded: false, integrity: "green" },
    { _id: id("sample_a3"), assessmentId: id("sample_task_1"), assessmentTitle: "Build a recipe page", kind: "task", courseId: id("sample_course_web"), courseTitle: "Web basics", number: 1, status: "submitted", startedAt: NOW - 6 * DAY, submittedAt: NOW - 5 * DAY, score: 7, maxScore: 10, percent: 70, needsGrading: false, autoSubmitted: true, graded: true, integrity: "red" },
    { _id: id("sample_a4"), assessmentId: id("sample_quiz_1"), assessmentTitle: "HTML basics", kind: "quiz", courseId: id("sample_course_web"), courseTitle: "Web basics", number: 1, status: "submitted", startedAt: NOW - 12 * DAY, submittedAt: NOW - 12 * DAY + 15 * 60 * 1000, score: undefined, maxScore: 8, percent: undefined, needsGrading: true, autoSubmitted: false, graded: false, integrity: "green" },
  ],
  stats: { attempts: 4, submitted: 3, inProgress: 1, needsGrading: 1, averagePercent: 80, bestPercent: 90, flagged: 1 },
};

const staffRow = (fields: Partial<StaffRow> & Pick<StaffRow, "name" | "email" | "roles">): StaffRow => ({
  userId: id(`sample_s_${fields.email}`),
  avatarUrl: undefined,
  locale: "ka",
  joinedAt: NOW - 90 * DAY,
  ownedCourses: 2,
  assistantCourses: 0,
  groups: 2,
  lastActiveAt: NOW - 3 * HOUR,
  emailOff: undefined,
  ...fields,
});

const staffRows: StaffRow[] = [
  staffRow({ name: "Giorgi Khvichia", email: "owner@kalami.space", roles: [{ membershipId: id("sample_r0"), role: "super_admin", universityId: undefined, universityName: undefined }], ownedCourses: 0, groups: 0, lastActiveAt: NOW - 10 * 60 * 1000 }),
  staffRow({ name: "Levan Abashidze", email: "levan@tsu.ge", roles: [{ membershipId: id("sample_r1"), role: "lecturer", universityId: tsu._id, universityName: tsu.name }], ownedCourses: 5, groups: 4, lastActiveAt: NOW - DAY }),
  staffRow({ name: "Nino Beridze", email: "nino.beridze@gsu.edu.ge", roles: [{ membershipId: id("sample_r2"), role: "lecturer", universityId: gori._id, universityName: gori.name }], ownedCourses: 3, assistantCourses: 1, groups: 2 }),
  staffRow({ name: "Tea Todua", email: "dean@gsu.edu.ge", roles: [{ membershipId: id("sample_r3"), role: "uni_admin", universityId: gori._id, universityName: gori.name }, { membershipId: id("sample_r4"), role: "lecturer", universityId: gori._id, universityName: gori.name }], ownedCourses: 1, groups: 1 }),
  staffRow({ name: "", email: "tutor@gmail.com", roles: [{ membershipId: id("sample_r5"), role: "lecturer", universityId: undefined, universityName: undefined }], ownedCourses: 1, groups: 1, lastActiveAt: undefined, emailOff: "complained" }),
];

const staffDetail: StaffDetail = {
  profile: staffRows[2],
  courses: [
    { _id: id("sample_course_web"), title: "Web basics", status: "published", universityName: gori.name, role: "owner", students: 28, assessments: { draft: 2, published: 4, archived: 0 }, updatedAt: NOW - 2 * HOUR },
    { _id: id("sample_course_js"), title: "JavaScript fundamentals", status: "draft", universityName: gori.name, role: "owner", students: 0, assessments: { draft: 1, published: 0, archived: 0 }, updatedAt: NOW - 5 * DAY },
    { _id: id("sample_course_db"), title: "Databases", status: "archived", universityName: gori.name, role: "assistant", students: 31, assessments: { draft: 0, published: 8, archived: 0 }, updatedAt: NOW - 90 * DAY },
  ],
  groups: [
    { _id: id("sample_group_a"), name: "ICT-24-1", universityName: gori.name, members: 38, archived: false, joinedAt: NOW - 9 * DAY },
    { _id: id("sample_group_c"), name: "ICT-24-3", universityName: gori.name, members: 41, archived: false, joinedAt: NOW - 8 * DAY },
  ],
  activity: recent.slice(0, 2),
};

const courseRow = (fields: Partial<CourseRow> & Pick<CourseRow, "title">): CourseRow => ({
  _id: id(`sample_course_${fields.title.length}`),
  _creationTime: NOW - 20 * DAY,
  description: undefined,
  semester: "Spring 2026",
  locale: "ka",
  status: "published",
  joinCode: "K7F2QX",
  joinEnabled: true,
  universityId: gori._id,
  universityName: gori.name,
  ownerId: id("sample_s_nino.beridze@gsu.edu.ge"),
  ownerName: "Nino Beridze",
  ownerEmail: "nino.beridze@gsu.edu.ge",
  students: 28,
  assessments: { draft: 2, published: 4, archived: 0 },
  createdVia: "web",
  updatedAt: NOW - 2 * HOUR,
  ...fields,
});

const courseRows: CourseRow[] = [
  courseRow({ _id: id("sample_course_web"), title: "Web basics", description: "HTML, CSS and the first steps of a web page." }),
  courseRow({ _id: id("sample_course_js"), title: "JavaScript fundamentals", status: "draft", joinCode: "MZ4R8H", students: 0, assessments: { draft: 1, published: 0, archived: 0 }, createdVia: "mcp", updatedAt: NOW - 5 * DAY }),
  courseRow({ _id: id("sample_course_ba"), title: "Business analytics", universityId: tsu._id, universityName: tsu.name, ownerName: "Levan Abashidze", ownerEmail: "levan@tsu.ge", joinCode: "P8R2WQ", students: 64, assessments: { draft: 0, published: 9, archived: 2 }, updatedAt: NOW - DAY }),
  courseRow({ _id: id("sample_course_tutor"), title: "Saturday maths", universityId: undefined, universityName: undefined, ownerName: "tutor@gmail.com", ownerEmail: "tutor@gmail.com", semester: undefined, joinCode: "TT4K9M", students: 6, assessments: { draft: 3, published: 2, archived: 0 }, updatedAt: NOW - 3 * DAY }),
  courseRow({ _id: id("sample_course_db"), title: "Databases", status: "archived", semester: "Autumn 2025", joinCode: "QW9T3N", joinEnabled: false, students: 31, assessments: { draft: 0, published: 8, archived: 0 }, updatedAt: NOW - 90 * DAY }),
];

const courseDetail: AdminCourseDetail = {
  course: courseRows[0],
  staff: [
    { userId: id("sample_s_nino.beridze@gsu.edu.ge"), name: "Nino Beridze", email: "nino.beridze@gsu.edu.ge", role: "owner" },
    { userId: id("sample_s_dean@gsu.edu.ge"), name: "Tea Todua", email: "dean@gsu.edu.ge", role: "assistant" },
  ],
  assessments: [
    { _id: id("sample_midterm"), title: "Midterm · Web basics", kind: "midterm", status: "published", questionCount: 4, totalPoints: 12, opensAt: NOW - HOUR, closesAt: NOW + 50 * 60 * 1000, inProgress: 24, submitted: 3, publishedAt: NOW - DAY, updatedAt: NOW - HOUR },
    { _id: id("sample_quiz_2"), title: "CSS selectors", kind: "quiz", status: "published", questionCount: 10, totalPoints: 10, opensAt: undefined, closesAt: undefined, inProgress: 0, submitted: 26, publishedAt: NOW - 12 * 60 * 1000, updatedAt: NOW - 12 * 60 * 1000 },
    { _id: id("sample_task_1"), title: "Build a recipe page", kind: "task", status: "published", questionCount: 1, totalPoints: 10, opensAt: undefined, closesAt: NOW - 5 * DAY, inProgress: 0, submitted: 27, publishedAt: NOW - 9 * DAY, updatedAt: NOW - 5 * DAY },
    { _id: id("sample_quiz_old"), title: "Warm-up quiz (from last year)", kind: "quiz", status: "draft", questionCount: 5, totalPoints: 5, opensAt: undefined, closesAt: undefined, inProgress: 0, submitted: 0, publishedAt: undefined, updatedAt: NOW - 30 * DAY },
  ],
  groups: [{ _id: id("sample_group_a"), name: "ICT-24-1", members: 38 }],
  enrollments: { active: 28, removed: 2 },
};

const groupRow = (fields: Partial<GroupRow> & Pick<GroupRow, "name">): GroupRow => ({
  _id: id(`sample_g_${fields.name}`),
  _creationTime: NOW - 10 * DAY,
  description: undefined,
  universityId: gori._id,
  universityName: gori.name,
  ownerName: "Tea Todua",
  archived: false,
  inviteEnabled: true,
  members: 38,
  pendingInvites: 2,
  lecturers: 3,
  courses: 3,
  updatedAt: NOW - DAY,
  ...fields,
});

const groupRows: GroupRow[] = [
  groupRow({ name: "ICT-24-1", description: "Informatics, first year, Mondays and Thursdays" }),
  groupRow({ name: "ICT-24-3", description: "Informatics, first year, evening", inviteEnabled: false, members: 41, lecturers: 4, courses: 5, pendingInvites: 0 }),
  groupRow({ name: "ICT-21-1", archived: true, members: 35, lecturers: 2, courses: 4, pendingInvites: 0 }),
  groupRow({ name: "BA-23-1", universityId: tsu._id, universityName: tsu.name, ownerName: "Davit Gelashvili", members: 64, lecturers: 6, courses: 9 }),
  groupRow({ name: "Saturday tutoring", description: "Grade 11, at home", universityId: undefined, universityName: undefined, ownerName: "tutor@gmail.com", members: 6, lecturers: 1, courses: 2, pendingInvites: 0 }),
];

const systemInfo: SystemInfo = {
  deploy: { busy: true, reason: "“Midterm · Web basics” closes within two hours and students are still working on it" },
  email: {
    configured: true,
    suppressions: [
      { _id: id("sample_sup1"), email: "giorgi@school.ge", status: "bounced", at: NOW - 3 * DAY, userId: id("sample_u_giorgi@school.ge"), name: "Giorgi Lomidze" },
      { _id: id("sample_sup2"), email: "old.address@mail.ru", status: "complained", at: NOW - 40 * DAY, userId: undefined, name: undefined },
    ],
  },
  migration: { materialsLeft: 0 },
  attemptsInProgress: 27,
  scheduledJobs: [
    { name: "auto-submit closed tasks", every: "1 minute", does: "Submits work still open when its task closed, as it stands." },
    { name: "deadline reminders", every: "5 minutes", does: "“Due tomorrow” and “due in an hour” notifications." },
    { name: "delete old conversations", every: "24 hours", does: "Removes conversations resolved more than a year ago." },
    { name: "move materials into weeks", every: "1 hour", does: "Finishes the legacy materials → weeks migration." },
    { name: "clean up sent emails", every: "24 hours", does: "Drops delivery records older than a week." },
  ],
};

const noop = () => undefined;

export const adminViews: Record<string, string> = {
  "panel-overview": "Admin panel · overview (platform admin)",
  "panel-overview-uni": "Admin panel · overview (university admin)",
  "panel-students": "Admin panel · students",
  "panel-student": "Admin panel · one student (dialog)",
  "panel-lecturers": "Admin panel · lecturers",
  "panel-lecturer": "Admin panel · one lecturer (dialog)",
  "panel-courses": "Admin panel · courses",
  "panel-course": "Admin panel · one course (dialog)",
  "panel-universities": "Admin panel · universities",
  "panel-groups": "Admin panel · groups",
  "panel-activity": "Admin panel · activity log",
  "panel-system": "Admin panel · system",
  "panel-notifications": "Admin panel · notifications (compose + history)",
  "panel-notification": "Admin panel · one message (dialog with recipients)",
};

const broadcastRows: BroadcastRow[] = [
  {
    _id: id("sample_b1"),
    _creationTime: NOW - 25 * 60 * 1000,
    senderName: "Giorgi Khvichia",
    from: { ka: "კალამი", en: "Kalami" },
    title: "Kalami is getting push notifications",
    body: "From this week you can turn on notifications in the app and hear about new work and deadlines on your phone.\n\nOpen the bell and switch them on.",
    link: "/dashboard",
    groupId: undefined,
    groupName: undefined,
    audienceLabel: "All students",
    channels: { push: true, email: true },
    emailEveryone: false,
    status: "sending",
    recipients: 640,
    inApp: 640,
    pushed: 212,
    emailed: 598,
    finishedAt: undefined,
  },
  {
    _id: id("sample_b2"),
    _creationTime: NOW - 2 * DAY,
    senderName: "Tea Todua",
    from: gori.name,
    title: "Welcome to ICT-24-1",
    body: "This is your group for the year: its courses, materials and tasks will show up on your dashboard.\n\nSee you on Monday at 10:00 in room 214.",
    link: undefined,
    groupId: id("sample_group_ict"),
    groupName: "ICT-24-1",
    audienceLabel: "28 email addresses, invited to ICT-24-1",
    channels: { push: false, email: true },
    emailEveryone: false,
    status: "sent",
    recipients: 28,
    inApp: 11,
    pushed: 0,
    emailed: 28,
    finishedAt: NOW - 2 * DAY + 4000,
  },
  {
    _id: id("sample_b3"),
    _creationTime: NOW - 6 * DAY,
    senderName: "Giorgi Khvichia",
    from: { ka: "კალამი", en: "Kalami" },
    title: "Midterm schedule published",
    body: "The midterm dates are in each course's Exams section. Check yours and ask your lecturer if something doesn't fit.",
    link: "/dashboard",
    groupId: undefined,
    groupName: undefined,
    audienceLabel: "Course Web basics",
    channels: { push: false, email: true },
    emailEveryone: true,
    status: "sent",
    recipients: 42,
    inApp: 42,
    pushed: 0,
    emailed: 39,
    finishedAt: NOW - 6 * DAY + 2500,
  },
];

const deliveryRows: DeliveryRow[] = [
  { _id: id("sample_d1"), userId: id("sample_u1"), name: "Ana Beridze", email: "ana.beridze@gsu.edu.ge", role: "student", inApp: true, devices: 0, emailed: true, emailSkipped: undefined, invited: true },
  { _id: id("sample_d2"), userId: id("sample_u2"), name: "Giorgi Maisuradze", email: "g.maisuradze@gsu.edu.ge", role: "student", inApp: true, devices: 0, emailed: true, emailSkipped: undefined, invited: false },
  { _id: id("sample_d3"), userId: undefined, name: "", email: "mariam.kapanadze@gmail.com", role: "none", inApp: false, devices: 0, emailed: true, emailSkipped: undefined, invited: true },
  { _id: id("sample_d4"), userId: undefined, name: "", email: "luka.ts@gmail.com", role: "none", inApp: false, devices: 0, emailed: false, emailSkipped: "blocked", invited: true },
];

const previewSample: AudiencePreview = {
  recipients: 28,
  students: 22,
  staff: 0,
  noAccount: 6,
  withPush: 9,
  emailable: 25,
  optedOut: 2,
  blocked: 1,
  capped: false,
  emailConfigured: true,
  pushConfigured: true,
};

const peopleHits: PersonHit[] = [
  { userId: id("sample_u1"), name: "Ana Beridze", email: "ana.beridze@gsu.edu.ge", roles: ["student"], universityName: gori.name },
  { userId: id("sample_u5"), name: "Anna Kiknadze", email: "anna.kiknadze@tsu.ge", roles: ["lecturer"], universityName: tsu.name },
];

/** The admin panel screen for a gallery view, or null if the view isn't one of ours. */
export function renderAdminView(view: string): ReactNode | null {
  const studentsPage = (
    <StudentsView rows={studentRows} status="more" onLoadMore={noop} query="" onQuery={noop} searching={false} scopeLabel="Every university" onOpen={noop} />
  );
  const staffPage = (
    <StaffView rows={staffRows} roleFilter="all" onRoleFilter={noop} query="" onQuery={noop} searching={false} isSuperAdmin scopeLabel="Every university" now={NOW} onOpen={noop} />
  );
  const coursesPage = (
    <CoursesView rows={courseRows} status="done" onLoadMore={noop} statusFilter="all" onStatusFilter={noop} query="" onQuery={noop} searching={false} scopeLabel="Every university" onOpen={noop} />
  );
  const notificationsPage = (
    <NotificationsView
      universities={[gori, tsu]}
      filter={undefined}
      isSuperAdmin
      scopeLabel="Every university"
      groups={groupRows}
      courses={courseRows}
      courseQuery=""
      onCourseQuery={noop}
      people={peopleHits}
      peopleQuery="an"
      onPeopleQuery={noop}
      preview={previewSample}
      onAudience={noop}
      history={broadcastRows}
      now={NOW}
      onOpen={noop}
      onSend={pause}
    />
  );
  switch (view) {
    case "panel-overview":
      return adminPage(<OverviewView overview={overview} scopeLabel="Every university" now={NOW} />, "/admin");
    case "panel-overview-uni":
      return adminPage(<OverviewView overview={overviewUni} scopeLabel={gori.name.en} now={NOW} />, "/admin", uniAdminMe);
    case "panel-students":
      return adminPage(studentsPage, "/admin/students");
    case "panel-student":
      return adminPage(
        <>
          {studentsPage}
          <StudentDetailDialog detail={studentDetail} open onClose={noop} universities={[gori, tsu]} isSuperAdmin actions={{ onSetEnrollment: pause, onSaveProfile: pause }} />
        </>,
        "/admin/students",
      );
    case "panel-lecturers":
      return adminPage(staffPage, "/admin/lecturers");
    case "panel-lecturer":
      return adminPage(
        <>
          {staffPage}
          <StaffDetailDialog detail={staffDetail} open onClose={noop} universities={[gori, tsu]} isSuperAdmin now={NOW} actions={{ onChangeRole: pause, onRemoveRole: pause, onAddRole: pause }} />
        </>,
        "/admin/lecturers",
      );
    case "panel-courses":
      return adminPage(coursesPage, "/admin/courses");
    case "panel-course":
      return adminPage(
        <>
          {coursesPage}
          <CourseDetailDialog
            detail={courseDetail}
            open
            onClose={noop}
            actions={{ onSetStatus: pause, onSetJoining: pause, onNewJoinCode: pause, onTransfer: pause, onDelete: pause, onSetAssessmentStatus: pause }}
          />
        </>,
        "/admin/courses",
      );
    case "panel-universities":
      return adminPage(<UniversitiesView rows={universityRows} isSuperAdmin onCreate={pause} onUpdate={pause} />, "/admin/universities");
    case "panel-groups":
      return adminPage(
        <GroupsView
          rows={groupRows}
          universities={[gori, tsu]}
          filter={undefined}
          isSuperAdmin
          scopeLabel="Every university"
          actions={{
            onCreate: async () => {
              await pause();
              return "sample_group_new";
            },
            onArchive: pause,
            onSetLink: pause,
          }}
        />,
        "/admin/groups",
      );
    case "panel-activity":
      return adminPage(<ActivityView rows={recent} status="more" onLoadMore={noop} filter="" onFilter={noop} now={NOW} />, "/admin/activity");
    case "panel-system":
      return adminPage(<SystemView system={systemInfo} onAllowEmail={pause} />, "/admin/system");
    case "panel-notifications":
      return adminPage(notificationsPage, "/admin/notifications");
    case "panel-notification":
      return adminPage(
        <>
          {notificationsPage}
          <BroadcastDetailDialog broadcast={broadcastRows[1]} recipients={deliveryRows} status="more" onLoadMore={noop} open onClose={noop} />
        </>,
        "/admin/notifications",
      );
    default:
      return null;
  }
}
