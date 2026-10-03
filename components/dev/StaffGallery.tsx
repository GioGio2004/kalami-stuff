"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { AdminView, type AdminUniversity } from "@/components/admin/AdminView";
import { InvitesBoard, type Invite } from "@/components/admin/InvitesBoard";
import { AgentsView } from "@/components/agents/AgentsView";
import { InviteScreen } from "@/components/AcceptInvite";
import { CurrentUserContext, type CurrentUser, type Me } from "@/components/CurrentUserProvider";
import { StaffGate } from "@/components/StaffGate";
import { StaffNav } from "@/components/StaffNav";
import { AssessmentBuilder } from "@/components/studio/AssessmentBuilder";
import { CourseView } from "@/components/studio/CourseView";
import { StudioDashboard } from "@/components/studio/StudioDashboard";
import type {
  AssessmentDetail,
  AuditEntry,
  CourseDetail,
  CourseSummary,
  QuestionWithKey,
  TokenRow,
} from "@/components/studio/types";
import { LoadingScreen } from "@/components/ui/StatusScreen";

// Development-only screen gallery with sample data: lets signed-in screens be
// reviewed without an account. The route 404s in production.

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();

const gori: AdminUniversity = {
  _id: "sample_gori" as AdminUniversity["_id"],
  name: { ka: "გორის სახელმწიფო უნივერსიტეტი", en: "Gori State University" },
  slug: "gori-state",
  status: "active",
};

const superAdmin: Me = {
  _id: "sample_owner" as Me["_id"],
  email: "owner@kalami.space",
  firstName: "Giorgi",
  lastName: undefined,
  avatarUrl: undefined,
  locale: "en",
  memberships: [{ role: "super_admin", universityId: undefined }],
  isStaff: true,
  isSuperAdmin: true,
  honestyAccepted: false,
  student: null,
  needsOnboarding: true,
  studioIntroSeenAt: NOW - DAY,
};
const student: Me = {
  ...superAdmin,
  email: "ana@example.com",
  firstName: "Ana",
  memberships: [{ role: "student", universityId: gori._id }],
  isStaff: false,
  isSuperAdmin: false,
};

const invite = (fields: Partial<Invite> & Pick<Invite, "email">): Invite => ({
  _id: `sample_${fields.email}` as Invite["_id"],
  _creationTime: NOW - DAY,
  role: "lecturer",
  token: undefined,
  expiresAt: NOW + 12 * DAY,
  acceptedAt: undefined,
  revokedAt: undefined,
  ...fields,
});

const invites: Invite[] = [
  invite({ email: "nino@gsu.edu.ge", token: "sample-token-1" }),
  invite({ email: "dean@gsu.edu.ge", role: "uni_admin", acceptedAt: NOW - 2 * DAY }),
  invite({ email: "late@gsu.edu.ge", expiresAt: NOW - DAY }),
  invite({ email: "oops@gsu.edu.ge", revokedAt: NOW - 3 * DAY }),
];

const inviteInfo = {
  email: "nino@gsu.edu.ge",
  role: "lecturer" as const,
  universityName: gori.name,
  expiresAt: NOW + 12 * DAY,
  status: "pending" as const,
};

// --- Studio samples ----------------------------------------------------------

const webBasics: CourseSummary = {
  _id: "sample_course_web" as CourseSummary["_id"],
  _creationTime: NOW - 20 * DAY,
  title: "Web basics",
  description: "HTML, CSS and the first steps of a web page.",
  semester: "Spring 2026",
  locale: "ka",
  status: "published",
  joinCode: "K7F2QX",
  joinEnabled: true,
  universityId: gori._id,
  universityName: gori.name,
  role: "owner",
  canEdit: true,
  counts: { tasks: 0, quizzes: 3, midterms: 1, finals: 0, drafts: 2, published: 2 },
  createdVia: "web",
  updatedAt: NOW - 2 * 60 * 60 * 1000,
};

const courses: CourseSummary[] = [
  webBasics,
  {
    ...webBasics,
    _id: "sample_course_js" as CourseSummary["_id"],
    title: "JavaScript fundamentals",
    description: undefined,
    status: "draft",
    joinCode: "MZ4R8H",
    counts: { tasks: 0, quizzes: 0, midterms: 0, finals: 0, drafts: 0, published: 0 },
    createdVia: "mcp",
    updatedAt: NOW - 5 * DAY,
  },
  {
    ...webBasics,
    _id: "sample_course_db" as CourseSummary["_id"],
    title: "Databases",
    semester: "Autumn 2025",
    status: "archived",
    joinCode: "QW9T3N",
    joinEnabled: false,
    role: "admin",
    counts: { tasks: 0, quizzes: 6, midterms: 1, finals: 1, drafts: 0, published: 8 },
    updatedAt: NOW - 90 * DAY,
  },
];

const activity: AuditEntry[] = [
  {
    _id: "a1" as AuditEntry["_id"],
    via: "mcp",
    action: "question.add",
    targetTable: "assessments",
    targetId: "x",
    courseId: webBasics._id,
    summary: 'Added 10 questions to "CSS selectors"',
    at: NOW - 2 * 60 * 1000,
    actorName: "Giorgi",
    mine: true,
  },
  {
    _id: "a2" as AuditEntry["_id"],
    via: "mcp",
    action: "assessment.create",
    targetTable: "assessments",
    targetId: "x",
    courseId: webBasics._id,
    summary: 'Created quiz "CSS selectors" as a draft',
    at: NOW - 3 * 60 * 1000,
    actorName: "Giorgi",
    mine: true,
  },
  {
    _id: "a3" as AuditEntry["_id"],
    via: "web",
    action: "assessment.published",
    targetTable: "assessments",
    targetId: "x",
    courseId: webBasics._id,
    summary: 'Published "HTML basics"',
    at: NOW - DAY,
    actorName: "Giorgi",
    mine: true,
  },
  {
    _id: "a4" as AuditEntry["_id"],
    via: "web",
    action: "course.create",
    targetTable: "courses",
    targetId: "x",
    courseId: webBasics._id,
    summary: 'Created course "Web basics"',
    at: NOW - 20 * DAY,
    actorName: "Giorgi",
    mine: true,
  },
];

const assessment: AssessmentDetail["assessment"] = {
  _id: "sample_midterm" as AssessmentDetail["assessment"]["_id"],
  _creationTime: NOW - 3 * DAY,
  courseId: webBasics._id,
  kind: "midterm",
  title: "Midterm · Web basics",
  instructions: "Closed book. You may use the browser devtools, nothing else.",
  status: "draft",
  settings: {
    opensAt: NOW + 7 * DAY,
    closesAt: NOW + 7 * DAY + 2 * 60 * 60 * 1000,
    timeLimitMin: 60,
    attemptsAllowed: 1,
    shuffleQuestions: true,
    shuffleOptions: true,
    integrityLevel: "strict",
    resultsVisibility: "score",
  },
  questionCount: 4,
  totalPoints: 12,
  createdVia: "mcp",
  publishedAt: undefined,
  updatedAt: NOW - 60 * 60 * 1000,
};

const questions: QuestionWithKey[] = [
  {
    _id: "q1" as QuestionWithKey["_id"],
    order: 0,
    type: "single",
    prompt: "Which tag makes a link?",
    points: 2,
    options: [
      { id: "o1", text: "<a>" },
      { id: "o2", text: "<link>" },
      { id: "o3", text: "<href>" },
    ],
    explanation: "<link> is for stylesheets and other resources.",
    code: undefined,
    key: { type: "single", correctOptionId: "o1" },
    createdVia: "mcp",
  },
  {
    _id: "q2" as QuestionWithKey["_id"],
    order: 1,
    type: "multiple",
    prompt: "Which of these are block-level elements?",
    points: 3,
    options: [
      { id: "o4", text: "<div>" },
      { id: "o5", text: "<span>" },
      { id: "o6", text: "<p>" },
      { id: "o7", text: "<strong>" },
    ],
    explanation: undefined,
    code: undefined,
    key: { type: "multiple", correctOptionIds: ["o4", "o6"] },
    createdVia: "mcp",
  },
  {
    _id: "q3" as QuestionWithKey["_id"],
    order: 2,
    type: "short",
    prompt: "What does CSS stand for?",
    points: 3,
    options: undefined,
    explanation: undefined,
    code: undefined,
    key: { type: "short", acceptedAnswers: ["Cascading Style Sheets"], caseSensitive: false },
    createdVia: "web",
  },
  {
    _id: "q4" as QuestionWithKey["_id"],
    order: 3,
    type: "essay",
    prompt: "Explain the box model in your own words.",
    points: 4,
    options: undefined,
    explanation: undefined,
    code: undefined,
    key: { type: "essay", rubric: "Mentions content, padding, border and margin, in order." },
    createdVia: "web",
  },
];

const courseDetail: CourseDetail = {
  ...webBasics,
  assessments: [
    { ...assessment, _id: "sample_quiz_1" as AssessmentDetail["assessment"]["_id"], kind: "quiz", title: "HTML basics", status: "published", settings: { ...assessment.settings, timeLimitMin: undefined, integrityLevel: "standard", opensAt: undefined, closesAt: undefined }, questionCount: 8, totalPoints: 8, createdVia: "web", publishedAt: NOW - DAY },
    { ...assessment, _id: "sample_quiz_2" as AssessmentDetail["assessment"]["_id"], kind: "quiz", title: "CSS selectors", settings: { ...assessment.settings, timeLimitMin: undefined, integrityLevel: "standard", opensAt: undefined, closesAt: undefined }, questionCount: 10, totalPoints: 10 },
    assessment,
  ],
};

const tokens: TokenRow[] = [
  { _id: "t1" as TokenRow["_id"], _creationTime: NOW - 3 * DAY, name: "Claude Code on my laptop", prefix: "klm_1a2b3c", lastUsedAt: NOW - 2 * 60 * 1000, revokedAt: undefined },
  { _id: "t2" as TokenRow["_id"], _creationTime: NOW - 30 * DAY, name: "Old desktop", prefix: "klm_9f8e7d", lastUsedAt: NOW - 20 * DAY, revokedAt: NOW - 10 * DAY },
];

const fakeAvatar = (
  <span className="grid size-10 place-items-center rounded-full bg-highlighter text-sm font-semibold">GK</span>
);

function asUser(value: CurrentUser, children: ReactNode) {
  return <CurrentUserContext.Provider value={value}>{children}</CurrentUserContext.Provider>;
}

function staffPage(children: ReactNode) {
  return asUser(
    { status: "ready", me: superAdmin },
    <>
      <StaffNav avatar={fakeAvatar} />
      <main className="mx-auto w-full max-w-[88rem] flex-1 px-3 pb-10 pt-5 sm:px-6">{children}</main>
    </>,
  );
}

async function pause(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 600));
}

const views: Record<string, string> = {
  courses: "Studio · courses",
  "courses-empty": "Studio · no courses yet",
  "studio-intro": "Studio · first-visit intro card",
  course: "Studio · course page",
  builder: "Studio · assessment builder",
  agents: "Agents · MCP tokens and setup",
  admin: "Admin · super admin",
  "admin-empty": "Admin · no universities yet",
  "invite-signed-out": "Invite · signed out",
  "invite-ready": "Invite · signed in with the invited email",
  "invite-mismatch": "Invite · signed in with another email",
  "invite-expired": "Invite · expired",
  "gate-student": "Gate · student account",
  loading: "Loading",
};

export function StaffGallery({ view }: { view?: string }) {
  if (!view || !(view in views)) {
    return (
      <main className="mx-auto w-full max-w-2xl px-6 py-16">
        <h1 className="text-3xl font-medium tracking-tight">Screen gallery</h1>
        <p className="mt-2 text-graphite">Sample data, development only.</p>
        <ul className="mt-8 space-y-2">
          {Object.entries(views).map(([key, label]) => (
            <li key={key}>
              <Link href={`/dev/ui?view=${key}`} className="underline underline-offset-4">
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </main>
    );
  }

  const board = (
    <InvitesBoard
      invites={invites}
      canInviteAdmins
      onCreate={async () => {
        await pause();
        return { token: "sample-new-token" };
      }}
      onRevoke={pause}
    />
  );

  const dashboard = (introOpen: boolean, list: CourseSummary[]) => (
    <StudioDashboard
      me={superAdmin}
      courses={list}
      activity={list.length === 0 ? [] : activity}
      universities={[{ _id: gori._id, name: gori.name }]}
      introOpenInitially={introOpen}
      onCreateCourse={pause}
      onIntroSeen={() => undefined}
    />
  );

  switch (view) {
    case "courses":
      return staffPage(dashboard(false, courses));
    case "courses-empty":
      return staffPage(dashboard(false, []));
    case "studio-intro":
      return staffPage(dashboard(true, courses));
    case "course":
      return staffPage(
        <CourseView
          course={courseDetail}
          history={activity}
          onUpdateCourse={pause}
          onCreateAssessment={pause}
          onNewJoinCode={pause}
          onSetJoining={pause}
        />,
      );
    case "builder":
      return staffPage(
        <AssessmentBuilder
          detail={{ assessment, questions, canEdit: true, course: { _id: webBasics._id, title: webBasics.title } }}
          onUpdate={pause}
          onSetStatus={pause}
          onDelete={pause}
          onAddQuestion={pause}
          onUpdateQuestion={pause}
          onDeleteQuestion={pause}
          onReorder={pause}
        />,
      );
    case "agents":
      return staffPage(
        <AgentsView
          tokens={tokens}
          onCreateToken={async () => {
            await pause();
            return "klm_0123456789abcdef0123456789abcdef01234567";
          }}
          onRevokeToken={pause}
        />,
      );
    case "admin":
      return staffPage(
        <AdminView isSuperAdmin universities={[gori]} onCreateUniversity={pause} renderInvites={() => board} />,
      );
    case "admin-empty":
      return staffPage(<AdminView isSuperAdmin universities={[]} onCreateUniversity={pause} renderInvites={() => null} />);
    case "invite-signed-out":
      return <InviteScreen invite={inviteInfo} current={{ status: "signed-out" }} returnTo="/" onAccept={pause} />;
    case "invite-ready":
      return (
        <InviteScreen
          invite={inviteInfo}
          current={{ status: "ready", me: { ...superAdmin, email: inviteInfo.email } }}
          returnTo="/"
          onAccept={pause}
        />
      );
    case "invite-mismatch":
      return (
        <InviteScreen invite={inviteInfo} current={{ status: "ready", me: student }} returnTo="/" onAccept={pause} />
      );
    case "invite-expired":
      return (
        <InviteScreen
          invite={{ ...inviteInfo, expiresAt: NOW - DAY }}
          current={{ status: "signed-out" }}
          returnTo="/"
          onAccept={pause}
        />
      );
    case "gate-student":
      return asUser({ status: "ready", me: student }, <StaffGate>{null}</StaffGate>);
    default:
      return <LoadingScreen />;
  }
}
