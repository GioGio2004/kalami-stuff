"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { AdminView, type AdminUniversity } from "@/components/admin/AdminView";
import { InvitesBoard, type Invite } from "@/components/admin/InvitesBoard";
import { AgentsView } from "@/components/agents/AgentsView";
import { InviteScreen } from "@/components/AcceptInvite";
import { InboxView } from "@/components/inbox/InboxView";
import { ThreadView } from "@/components/inbox/ThreadView";
import type { InboxItem, Thread } from "@/components/inbox/types";
import { CurrentUserContext, type CurrentUser, type Me } from "@/components/CurrentUserProvider";
import { GroupsDashboard } from "@/components/groups/GroupsDashboard";
import { GroupView, type GroupActions } from "@/components/groups/GroupView";
import type { CourseGroups as CourseGroupsData, GroupDetail, GroupSummary } from "@/components/groups/types";
import { StaffGate } from "@/components/StaffGate";
import { StaffNav } from "@/components/StaffNav";
import { AssessmentBuilder } from "@/components/studio/AssessmentBuilder";
import { LessonEditor } from "@/components/lessons-editor/LessonEditor";
import { CourseGroups } from "@/components/studio/CourseGroups";
import { CourseOutline, type OutlineActions } from "@/components/studio/CourseOutline";
import { CourseView } from "@/components/studio/CourseView";
import { StudioDashboard } from "@/components/studio/StudioDashboard";
import type {
  Assessment,
  AssessmentDetail,
  AuditEntry,
  CourseDetail,
  CourseOutline as CourseOutlineData,
  CourseSummary,
  DriveConnection,
  LessonDetail,
  OutlineWeek,
  QuestionWithKey,
} from "@/components/studio/types";
import { LoadingScreen } from "@/components/ui/StatusScreen";
import { KalamiImport, type InspectResult } from "@/components/kalami/KalamiImport";

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
  students: 28,
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
  weekId: undefined,
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
      <StaffNav avatar={fakeAvatar} unread={2} />
      <main className="mx-auto w-full max-w-[88rem] flex-1 px-3 pb-10 pt-5 sm:px-6">{children}</main>
    </>,
  );
}

async function pause(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 600));
}

// --- Groups and materials samples ----------------------------------------------

const groupA: GroupSummary = {
  _id: "sample_group_a" as GroupSummary["_id"],
  _creationTime: NOW - 10 * DAY,
  name: "CS-101 A",
  description: "Mondays and Thursdays, room 204",
  inviteEnabled: true,
  archived: false,
  members: 3,
  pendingInvites: 2,
  courses: [{ _id: webBasics._id, title: webBasics.title, status: "published" }],
  updatedAt: NOW - DAY,
};

const groups: GroupSummary[] = [
  groupA,
  {
    ...groupA,
    _id: "sample_group_tutor" as GroupSummary["_id"],
    name: "Saturday tutoring",
    description: undefined,
    members: 0,
    pendingInvites: 0,
    courses: [],
    inviteEnabled: false,
  },
  { ...groupA, _id: "sample_group_old" as GroupSummary["_id"], name: "CS-101 A (2025)", archived: true, pendingInvites: 0 },
];

type MemberId = GroupDetail["memberList"][number]["userId"];
type GroupInviteId = GroupDetail["inviteList"][number]["_id"];

const groupDetail: GroupDetail = {
  ...groupA,
  inviteCode: "q3Xk9-mPz2LtV8wRbN4c",
  ownerName: "Nino Beridze",
  memberList: [
    { userId: "sample_u1" as MemberId, name: "Ana Kapanadze", email: "ana.k@gmail.com", via: "link", joinedAt: NOW - 6 * DAY },
    { userId: "sample_u2" as MemberId, name: "Giorgi Lomidze", email: "giorgi@school.ge", via: "email", joinedAt: NOW - 5 * DAY },
    { userId: "sample_u3" as MemberId, name: "Mariam Tsereteli", email: "mariam.ts@gmail.com", via: "link", joinedAt: NOW - DAY },
  ],
  inviteList: [
    { _id: "sample_gi1" as GroupInviteId, email: "luka@gmail.com", createdAt: NOW - 2 * DAY, expiresAt: NOW + 28 * DAY, emailedAt: NOW - 2 * DAY },
    { _id: "sample_gi2" as GroupInviteId, email: "old.address@mail.ru", createdAt: NOW - 40 * DAY, expiresAt: NOW - 10 * DAY, emailedAt: undefined },
  ],
};

const groupActions: GroupActions = {
  onUpdate: pause,
  onNewLink: pause,
  onSetLink: pause,
  onInvite: async (emails) => {
    await pause();
    return {
      invited: emails.split(/[\s,;]+/).filter((e) => e.includes("@")),
      emailed: 1,
      alreadyMembers: [],
      alreadyInvited: [],
      invalid: [],
    };
  },
  onResend: async () => {
    await pause();
    return true;
  },
  onWithdraw: pause,
  onRemoveStudent: pause,
  onShareCourse: pause,
  onUnshareCourse: pause,
};

const courseGroups: CourseGroupsData = {
  shared: [{ _id: groupA._id, name: groupA.name, members: 3, archived: false }],
  available: [{ _id: groups[1]._id, name: groups[1].name, members: 0 }],
};

// --- Course outline and lesson samples ---------------------------------------------

type WeekId = OutlineWeek["_id"];
type Lesson = OutlineWeek["lessons"][number];

const sampleAssessment = (fields: Partial<Assessment> & Pick<Assessment, "title" | "kind">): Assessment => ({
  ...assessment,
  _id: `sample_${fields.kind}_${fields.title.length}` as Assessment["_id"],
  status: "draft",
  createdVia: "web",
  settings: { ...assessment.settings, timeLimitMin: undefined, integrityLevel: "standard", opensAt: undefined, closesAt: undefined },
  questionCount: 8,
  totalPoints: 8,
  publishedAt: undefined,
  ...fields,
});

const sampleLesson = (fields: Partial<Lesson> & Pick<Lesson, "title">): Lesson => ({
  _id: `sample_lesson_${fields.title.length}` as Lesson["_id"],
  status: "draft",
  blockCount: 10,
  createdVia: "web",
  updatedAt: NOW - DAY,
  ...fields,
});

const outlineWeek = (fields: Partial<OutlineWeek> & Pick<OutlineWeek, "title" | "order">): OutlineWeek => ({
  _id: `sample_week_${fields.order}` as WeekId,
  status: "draft",
  description: undefined,
  publishedAt: undefined,
  links: [],
  drive: null,
  lessons: [],
  assessments: [],
  ...fields,
});

const outlineWeeks: OutlineWeek[] = [
  outlineWeek({
    order: 1,
    title: "Week 1 · How the web works",
    status: "published",
    publishedAt: NOW - 14 * DAY,
    description: "Browsers, servers and your first HTML page. Read the MDN guide before Thursday.",
    links: [
      { id: "l1", title: "MDN · Getting started with the web", url: "https://developer.mozilla.org/en-US/docs/Learn_web_development/Getting_started" },
      { id: "l2", title: "Slides · Week 1", url: "https://docs.google.com/presentation/d/sample/edit" },
    ],
    drive: { url: "https://drive.google.com/drive/folders/sample-week-1", shared: true, syncing: undefined, stale: false, error: undefined },
    lessons: [
      sampleLesson({ title: "What happens when you open a page", status: "published", blockCount: 12 }),
      sampleLesson({ title: "Your first HTML document", status: "published", blockCount: 9 }),
    ],
    assessments: [
      sampleAssessment({ kind: "quiz", title: "HTML basics", status: "published", publishedAt: NOW - 10 * DAY }),
      sampleAssessment({ kind: "task", title: "Build a recipe page", status: "published", questionCount: 1, totalPoints: 10, publishedAt: NOW - 9 * DAY }),
    ],
  }),
  outlineWeek({
    order: 2,
    title: "Week 2 · CSS selectors",
    description: "Type, class and ID selectors, and how the cascade picks a winner.",
    links: [{ id: "l3", title: "Selectors cheat sheet", url: "https://www.w3schools.com/cssref/css_selectors.php" }],
    drive: {
      url: undefined,
      shared: false,
      syncing: undefined,
      stale: false,
      error: "Your Google connection expired. Connect Google Drive again.",
    },
    lessons: [
      sampleLesson({ title: "Selecting elements with CSS", blockCount: 14, createdVia: "mcp", updatedAt: NOW - 60 * 60 * 1000 }),
      sampleLesson({ title: "Specificity, step by step", blockCount: 0 }),
    ],
    assessments: [
      sampleAssessment({ kind: "quiz", title: "CSS selectors", createdVia: "mcp", questionCount: 10, totalPoints: 10 }),
    ],
  }),
  outlineWeek({ order: 3, title: "Unit 3 · Layout" }),
];

const outlineData: CourseOutlineData = {
  courseId: webBasics._id,
  canEdit: true,
  driveAvailable: true,
  drive: { ownerName: "Nino Beridze", mine: true, canTakeOver: false, folderUrl: "https://drive.google.com/drive/folders/sample-root" },
  weeks: outlineWeeks,
  exams: [
    { ...assessment, title: "Midterm · Web basics" },
    sampleAssessment({
      kind: "final",
      title: "Final exam · Web basics",
      settings: { ...assessment.settings, timeLimitMin: 90, opensAt: NOW + 60 * DAY, closesAt: NOW + 60 * DAY + 3 * 60 * 60 * 1000 },
      questionCount: 30,
      totalPoints: 60,
    }),
  ],
  unplaced: [sampleAssessment({ kind: "quiz", title: "Warm-up quiz (from last year)", questionCount: 5, totalPoints: 5 })],
};

const outlineActions: OutlineActions = {
  onConnectDrive: pause,
  onMoveToMyDrive: pause,
  onCreateWeek: pause,
  onUpdateWeek: pause,
  onMoveWeek: pause,
  onPublishWeek: pause,
  onUnpublishWeek: pause,
  onRemoveWeek: pause,
  onAddLink: pause,
  onUpdateLink: pause,
  onRemoveLink: pause,
  onMoveLink: pause,
  onAddFolder: pause,
  onRetryDrive: pause,
  onCreateLesson: pause,
  onMoveLesson: pause,
  onCreateAssessment: pause,
  onPlace: pause,
};

type Block = LessonDetail["blocks"][number];

const lessonBlocks: Block[] = [
  {
    id: "b1",
    type: "text",
    md: "A **selector** tells the browser which elements a CSS rule styles. Pick the right one and a single rule can restyle a whole site.\n\nThis lesson covers the three you'll use every day:\n\n- type selectors, like `p`\n- class selectors, like `.button`\n- ID selectors, like `#menu`",
  },
  {
    id: "b2",
    type: "callout",
    tone: "definition",
    title: "Selector",
    md: "The part of a CSS rule before the `{`. It decides *which* elements the declarations inside apply to.",
  },
  {
    id: "b3",
    type: "code",
    language: "css",
    code: "h1 {\n  color: tomato;\n}\n\nli {\n  margin-bottom: 4px;\n}\n\nbutton {\n  padding: 8px 16px;\n  border-radius: 999px;\n}",
    caption: "Type selectors: every h1, every li, every button.",
    preview: true,
  },
  {
    id: "b4",
    type: "image",
    url: "https://upload.wikimedia.org/wikipedia/commons/d/d5/CSS3_logo_and_wordmark.svg",
    alt: "The CSS3 logo: a blue shield with the number 3",
    caption: "CSS has had selectors since the very first version.",
  },
  {
    id: "b5",
    type: "video",
    url: "https://www.youtube.com/watch?v=1PnVor36_40",
    caption: "CSS in 100 seconds",
  },
  {
    id: "b6",
    type: "steps",
    title: "Style a button with a class",
    steps: [
      { title: "Add the class", md: "In your HTML, give the button a class: `<button class=\"cta\">Sign up</button>`." },
      { title: "Write the rule", md: "In `style.css`, start a rule with a dot and the class name: `.cta { }`." },
      { md: "Inside the braces, set `background-color` and `color`. Save, and reload the page." },
    ],
  },
  {
    id: "b7",
    type: "callout",
    tone: "warning",
    md: "Class names are case-sensitive: `.CTA` won't match `class=\"cta\"`.",
  },
  {
    id: "b8",
    type: "check",
    check: {
      kind: "single",
      prompt: "Which selector matches every `<p>` inside an `<article>`?",
      options: [
        { text: "article p", correct: true },
        { text: "article + p", correct: false },
        { text: "p.article", correct: false },
      ],
      explanation: "A space means *descendant*: any `p` somewhere inside an `article`.",
    },
  },
  {
    id: "b9",
    type: "check",
    check: {
      kind: "short",
      prompt: "What character starts a class selector?",
      accepted: [".", "a dot", "dot", "full stop"],
    },
  },
];

const lessonDetail: LessonDetail = {
  _id: "sample_lesson_css" as LessonDetail["_id"],
  courseId: webBasics._id,
  courseTitle: webBasics.title,
  weekId: outlineWeeks[1]._id,
  weekTitle: outlineWeeks[1].title,
  weekStatus: "draft",
  title: "Selecting elements with CSS",
  status: "draft",
  blocks: lessonBlocks,
  canEdit: true,
  createdVia: "mcp",
  updatedAt: NOW - 60 * 60 * 1000,
};

function lessonPage(mode: "edit" | "preview") {
  return (
    <LessonEditor
      lesson={lessonDetail}
      initialMode={mode}
      onRename={pause}
      onSaveBlocks={async (blocks) => {
        await pause();
        return blocks.map((block, i) => block.id ?? `saved${i}`);
      }}
      onSetStatus={pause}
      onDelete={pause}
    />
  );
}

// --- Inbox samples ---------------------------------------------------------------

type ConversationId = InboxItem["_id"];
const inboxItem = (fields: Partial<InboxItem> & Pick<InboxItem, "subject" | "studentName">): InboxItem => ({
  _id: ("sample_conv_" + fields.subject.length) as ConversationId,
  recipient: "lecturer",
  topic: "assignment",
  customTopic: undefined,
  status: "open",
  lastMessageAt: NOW - 2 * 60 * 60 * 1000,
  lastMessageFrom: "student",
  messageCount: 1,
  unread: false,
  courseId: webBasics._id,
  courseTitle: webBasics.title,
  as: "lecturer",
  ...fields,
});

const inboxItems: InboxItem[] = [
  inboxItem({ subject: "Web basics · Week 3 · can't open the materials", studentName: "Ana Kapanadze", topic: "materials_access", unread: true, lastMessageAt: NOW - 20 * 60 * 1000 }),
  inboxItem({ subject: "Problem in Kalami: Web basics", studentName: "Giorgi Lomidze", topic: "app_problem", recipient: "admin", as: "admin", unread: true, lastMessageAt: NOW - 3 * 60 * 60 * 1000 }),
  inboxItem({ subject: "Web basics · Quiz 2 · grade question", studentName: "Mariam Tsereteli", topic: "grade", status: "answered", lastMessageFrom: "staff", messageCount: 2, lastMessageAt: NOW - DAY }),
  inboxItem({ subject: "Web basics · absence or schedule", studentName: "Luka Beridze", topic: "absence", status: "resolved", messageCount: 3, lastMessageAt: NOW - 6 * DAY }),
];

type MessageId = Thread["messages"][number]["_id"];
const sampleThread: Thread = {
  _id: inboxItems[0]._id,
  viewer: "lecturer",
  recipient: "lecturer",
  recipientName: "Nino Beridze",
  studentName: "Ana Kapanadze",
  studentEmail: "ana.k@gmail.com",
  topic: "materials_access",
  customTopic: undefined,
  subject: "Web basics · Week 3 · can't open the materials",
  status: "answered",
  context: {
    course: { _id: webBasics._id, title: webBasics.title, locale: "en" },
    week: { _id: "sample_week_3" as NonNullable<Thread["context"]["week"]>["_id"], title: "Week 3 · CSS selectors", url: "https://drive.google.com/drive/folders/sample" },
    assessment: undefined,
  },
  messages: [
    {
      _id: "sample_msg_1" as MessageId,
      _creationTime: NOW - 3 * 60 * 60 * 1000,
      from: "student",
      senderName: "Ana Kapanadze",
      mine: false,
      body: "Hello Nino Beridze,\n\nI can't open the “Week 3 · CSS selectors” materials for Web basics.\nLink: https://drive.google.com/drive/folders/sample\nWhat I see: Access denied.\n\nCould you check the link?\n\nThanks,\nAna Kapanadze",
      emailed: true,
    },
    {
      _id: "sample_msg_2" as MessageId,
      _creationTime: NOW - 20 * 60 * 1000,
      from: "staff",
      senderName: "Nino Beridze",
      mine: true,
      body: "Thanks Ana! I forgot to publish it. Try again now.",
      emailed: true,
    },
  ],
  truncated: false,
};

function coursePage(outline: CourseOutlineData, connection: DriveConnection, course: CourseDetail = courseDetail) {
  return (
    <CourseView
      course={course}
      history={activity}
      onUpdateCourse={pause}
      onExport={course.canEdit ? pause : undefined}
      onNewJoinCode={pause}
      onSetJoining={pause}
      groups={course.canEdit ? <CourseGroups groups={courseGroups} canEdit onShare={pause} onUnshare={pause} /> : undefined}
      outline={<CourseOutline data={outline} connection={connection} actions={outlineActions} locale="en" />}
    />
  );
}

// --- .kalami samples --------------------------------------------------------------

const kalamiSummary = {
  title: "Web basics",
  language: "en" as const,
  weeks: 12,
  lessons: 31,
  assessments: { task: 6, quiz: 11, midterm: 1, final: 1 },
  questions: 214,
  links: 24,
  exported: { by: "Nino Beridze", at: "2026-10-04T18:30:00.000Z", from: "Kalami" },
};
const kalamiVerified: InspectResult = {
  ok: true,
  summary: kalamiSummary,
  verified: { by: "Nino Beridze", at: "2026-10-04T18:30:00.000Z" },
};
const kalamiAiMade: InspectResult = {
  ok: true,
  summary: { ...kalamiSummary, title: "CSS in one week", weeks: 1, lessons: 3, assessments: { task: 0, quiz: 1, midterm: 0, final: 1 }, questions: 12, exported: { by: "Claude", at: "2026-10-04T20:00:00Z", from: "Claude" } },
  verified: null,
};
const kalamiBroken: InspectResult = {
  ok: false,
  summary: kalamiAiMade.ok ? kalamiAiMade.summary : undefined,
  errors: [
    "course › weeks[0] › lessons[1] › blocks[4] › alt: Too small: expected string to have >=1 characters",
    "course › exams[0] › questions[2]: A single-choice question needs exactly one correct option.",
    "course › weeks[0] › links[0]: Enter a full link that starts with https://",
  ],
};
const sampleKalamiFile = () => new File(["{}"], "web-basics.kalami", { type: "application/vnd.kalami+json" });

function kalamiDialog(result: InspectResult | null) {
  return (
    <KalamiImport
      open
      file={result ? sampleKalamiFile() : null}
      universities={[{ _id: gori._id, name: gori.name }]}
      onClose={() => undefined}
      onInspect={async () => {
        await pause();
        return result ?? kalamiVerified;
      }}
      onImport={async () => {
        await pause();
        return { ok: true as const, courseId: webBasics._id, summary: kalamiSummary, verified: null };
      }}
    />
  );
}

const views: Record<string, string> = {
  "kalami-import": ".kalami · import (drop zone)",
  "kalami-verified": ".kalami · import (verified Kalami file)",
  "kalami-ai": ".kalami · import (AI-written file)",
  "kalami-errors": ".kalami · import (file with problems)",
  courses: "Studio · courses",
  "courses-empty": "Studio · no courses yet",
  "studio-intro": "Studio · first-visit intro card",
  course: "Studio · course outline (Drive connected)",
  "course-connect": "Studio · course outline (connect Drive, no weeks yet)",
  "course-no-drive": "Studio · course outline (Drive not set up on server)",
  "course-view-only": "Studio · course outline (view only)",
  "lesson-editor": "Studio · lesson editor",
  "lesson-preview": "Studio · lesson preview",
  inbox: "Inbox · lecturer and team messages",
  "inbox-empty": "Inbox · nothing yet",
  thread: "Inbox · one conversation",
  "thread-team": "Inbox · a Kalami team conversation",
  groups: "Groups · list",
  "groups-empty": "Groups · none yet",
  group: "Groups · one group",
  builder: "Studio · assessment builder",
  agents: "Agents · connect an MCP client",
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
      onDeleteCourse={pause}
      onExportCourse={pause}
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
      return staffPage(coursePage(outlineData, { available: true, connected: true }));
    case "course-connect":
      return staffPage(
        coursePage({ ...outlineData, drive: null, weeks: [], unplaced: [] }, { available: true, connected: false }),
      );
    case "course-no-drive":
      return staffPage(
        coursePage(
          { ...outlineData, driveAvailable: false, drive: null, weeks: outlineWeeks.map((w) => ({ ...w, drive: null })) },
          { available: false, connected: false },
        ),
      );
    case "course-view-only":
      return staffPage(
        coursePage({ ...outlineData, canEdit: false }, { available: true, connected: false }, { ...courseDetail, canEdit: false }),
      );
    case "lesson-editor":
      return staffPage(lessonPage("edit"));
    case "lesson-preview":
      return staffPage(lessonPage("preview"));
    case "kalami-import":
      return staffPage(kalamiDialog(null));
    case "kalami-verified":
      return staffPage(kalamiDialog(kalamiVerified));
    case "kalami-ai":
      return staffPage(kalamiDialog(kalamiAiMade));
    case "kalami-errors":
      return staffPage(kalamiDialog(kalamiBroken));
    case "inbox":
      return staffPage(<InboxView items={inboxItems} now={NOW} />);
    case "inbox-empty":
      return staffPage(<InboxView items={[]} now={NOW} />);
    case "thread":
      return staffPage(<ThreadView thread={sampleThread} onReply={pause} onResolve={pause} />);
    case "thread-team":
      return staffPage(
        <ThreadView
          thread={{
            ...sampleThread,
            viewer: "admin",
            recipient: "admin",
            recipientName: "Kalami team",
            topic: "app_problem",
            subject: "Problem in Kalami: Web basics",
            status: "open",
            context: { course: sampleThread.context.course, week: undefined, assessment: undefined },
            messages: [{ ...sampleThread.messages[0], body: "Hello Kalami team,\n\nSomething in Kalami isn't working for me (Web basics).\nWhat happened: the quiz froze after question 3.\n\nCould you take a look?\n\nThanks,\nGiorgi" }],
          }}
          onReply={pause}
          onResolve={pause}
        />,
      );
    case "groups":
      return staffPage(<GroupsDashboard groups={groups} onCreate={pause} />);
    case "groups-empty":
      return staffPage(<GroupsDashboard groups={[]} onCreate={pause} />);
    case "group":
      return staffPage(<GroupView group={groupDetail} courses={courses} now={NOW} actions={groupActions} />);
    case "builder":
      return staffPage(
        <AssessmentBuilder
          detail={{ assessment, questions, canEdit: true, started: 0, course: { _id: webBasics._id, title: webBasics.title } }}
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
      return staffPage(<AgentsView />);
    case "admin":
      return staffPage(
        <AdminView
          isSuperAdmin
          universities={[gori]}
          onCreateUniversity={pause}
          renderInvites={() => board}
          independent={board}
        />,
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
