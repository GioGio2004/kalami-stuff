# Kalami Studio — course creation plan

> How lecturers build quizzes, midterms, finals and (later) animated lectures, by hand or
> through their own AI agent. Companion to `KALAMI.md`; this file is the working plan for
> the staff app (`kalami-stuff`, staff.kalami.space) and the backend it owns.

---

## 1. What is built now (Phase A)

| Area | Status | Where |
|---|---|---|
| Courses as the container (title, semester, language, join code) | ✅ | `convex/courses.ts`, `/courses` |
| Assessments: **quiz**, **midterm**, **final** with settings and draft → published → archived | ✅ | `convex/assessments.ts`, `/courses/[id]` |
| Questions: single choice, multiple choice, short answer, essay; answer keys in their own table | ✅ | `convex/questions.ts`, builder page |
| Dashboard with course cards and recent activity | ✅ | `components/studio/StudioDashboard.tsx` |
| First-visit intro card (how it works + how to connect an agent) | ✅ | `components/studio/StudioIntro.tsx` |
| MCP connector for personal agents | ✅ | `app/api/mcp/route.ts`, `convex/mcp.ts` |
| Agents page: sign-in setup steps per client | ✅ | `/agents` |
| Audit log of every change, marked web or agent | ✅ | `convex/audit.ts` |
| Access: lecturers, university admins, super admin only | ✅ | `convex/lib/access.ts` |
| Tests for roles, validation and the token flow | ✅ | `convex/studio.test.ts` |

**Deliberately not built yet:** lectures/lessons (see Phase C), matching/ordering
questions, surveys, course assistants UI. (Code questions and the student side are done.)

---

## 2. Who can do what

| Role | Create courses | Edit a course | See a course |
|---|---|---|---|
| Student | ✗ (refused by `requireStaffActor`) | ✗ | ✗ |
| Lecturer | ✓ in their own university | ✓ courses they own | own + assisted |
| Course assistant (per course, later UI) | ✗ | ✗ | that course |
| University admin | ✓ in their university | ✓ every course in it | every course in it |
| Super admin | ✓ anywhere (must pick the university) | ✓ all | all |

Rules that hold everywhere:

- The browser never sends a user id. Web calls derive the person from the Clerk session;
  MCP calls derive them from the token. Both become the same `Actor` and go through the
  same checks (`courseAccess`, `requireCourseEditor`).
- Courses you can't open look like they don't exist (`NOT_FOUND`), so nothing leaks.
- Answer keys live in `answerKeys`, never on the question document. Only staff functions
  join them in; the future student player will never read that table.

---

## 3. Data model (added this phase)

```
courses        universityId, ownerId, title, description?, semester?, locale, status,
               joinCode, joinEnabled, createdVia, updatedAt
courseStaff    courseId, userId, role (owner | assistant)
assessments    courseId, kind (quiz|midterm|final), title, instructions?, status,
               settings { opensAt?, closesAt?, timeLimitMin?, attemptsAllowed,
                          shuffleQuestions, shuffleOptions, integrityLevel, resultsVisibility },
               questionCount, totalPoints (denormalised), createdBy, createdVia, publishedAt?
questions      assessmentId, courseId, order, type, prompt, points, options?[{id,text}], explanation?
answerKeys     questionId, assessmentId, key (single | multiple | short | essay)
auditLog       actorId, via (web|mcp), action, targetTable, targetId, courseId?, summary, at
users          + studioIntroSeenAt?
```

Defaults by kind: quizzes get standard integrity and full results after close; midterms and
finals get strict integrity, one attempt, and a 60/90-minute timer. Lecturers can change all
of it.

---

## 4. The MCP connector

**Endpoint:** `https://staff.kalami.space/api/mcp` (Streamable HTTP, stateless).
**Auth: Sign in with Kalami (OAuth), for every client.** One address for everyone; each
lecturer signs in with their own account in their assistant and presses Allow, so there is
no token or link to copy, share or leak.

- Clerk is the authorization server (CIMD and dynamic client registration switched on in
  Clerk → OAuth applications → Settings). `/api/mcp` answers 401 with `resource_metadata`
  → `/.well-known/oauth-protected-resource` (also under `/api/mcp`) → Clerk
  (`/.well-known/oauth-authorization-server` is mirrored on our origin).
- The route checks the Clerk access token (`lib/mcp/oauth.ts`) and hands Convex a
  10-minute `svc.<payload>.<HMAC>` credential naming the Clerk user, signed with
  `MCP_SERVICE_SECRET`. That secret is server-to-server only, set once on Convex dev/prod,
  in the staff app's `.env.local` and in Vercel; lecturers never see it.
- Convex verifies the credential and still refuses non-staff, so a student who signs in
  gets nothing, and a lecturer who loses the role is cut off on the next call.
- To disconnect an agent, the lecturer removes Kalami in that app's settings.

Retired: personal `klm_` tokens (the `mcpTokens` table, created on `/agents`) and the secret
links (`/api/mcp/k/klm_…`, which answer 410). Old tokens no longer work anywhere. Any
leftover `mcpTokens` rows are inert and can be deleted in the Convex dashboard.

| Tool | Does |
|---|---|
| `whoami` | who signed in, their roles, the universities they can create in |
| `list_courses`, `get_course`, `create_course` | courses the person can edit |
| `create_assessment`, `update_assessment`, `get_assessment` | drafts; settings; questions with keys |
| `add_questions` (≤ 50 per call), `update_question`, `delete_question`, `reorder_questions` | the heavy lifting |

Not exposed on purpose: publish, archive, delete, anything about students, attempts or
grades. The server's `instructions` tell the agent to ask the lecturer to review and
publish in the dashboard.

Client recipes (all on `/agents`, step by step). Each one only needs the address; the
client then opens Kalami's sign-in page:

```bash
# Claude Code: add once, then /mcp → kalami → Authenticate
claude mcp add --transport http kalami https://staff.kalami.space/api/mcp
```

```json
// Cursor (.cursor/mcp.json): then log in from Cursor Settings → MCP
{ "mcpServers": { "kalami": { "url": "https://staff.kalami.space/api/mcp" } } }
```

claude.ai / Claude Desktop: Settings → Connectors → Add custom connector, Authentication
"Sign in now", OAuth client "Use Claude's published identity". VS Code uses
`.vscode/mcp.json` with `"type": "http"`.

**Limits and safety (2026-10-04):** every agent write is rate limited per lecturer
(`convex/lib/limits.ts`, the official `@convex-dev/rate-limiter` component); `create_course`,
`create_assessment` and `add_questions` take a `requestId` so a retried call returns the
same ids instead of duplicates (`agentRequests` table); the OAuth client the agent came
through is recorded in the audit log; agents never receive join codes; the service
credential lives 60 s. Settings in `OPERATIONS.md`.

---

### 4.1 The student connector (2026-10-06)

**Endpoint:** `https://app.kalami.space/api/mcp`, served by the student app (`kalami/lib/mcp/server.ts`,
`kalami/app/api/mcp`, the same `.well-known` metadata), with the same Sign in with Kalami flow and
the same `MCP_SERVICE_SECRET` credential; `lib/mcp/oauth.ts` is synced from this repo. Convex side:
`convex/study.ts` + `convex/model/study.ts`, queries only, `requireTokenStudent` (an onboarded
student; staff get 401 there, as students do here).

| Tool | Does |
|---|---|
| `whoami`, `list_courses`, `get_course` | the student, their courses, a course's weeks with lessons, presentations, materials and work |
| `get_lesson`, `get_presentation`, `find_in_courses` | a lesson's blocks; a presentation's slides and speaker notes; where a phrase appears across their published lessons and presentations |
| `my_progress`, `whats_next` | every piece of work with status and visible score; open work by deadline |
| `get_my_work` | a **finished** task, quiz or exam: questions as seen, own answers, score, feedback and comments, as far as `resultsVisibility` allows |

Finished = submitted and no way to take it again (closed, a code task, or no attempts left).
Questions and own answers show once closed or with full results; correct answers and
explanations only with full results; the score only when the setting shows it. Everything
reuses the student app's model functions (`getStudentCourse`, `getStudentLesson`,
`getStudentTask`, the quiz helpers), so the connector never shows more than the screen.
Students connect from `/assistant` in the student app. Tests: `convex/study.test.ts`.

## 5. Roadmap

### Phase A — Assessments + agents (done, this session)

Everything in section 1. Ships without the student side; lecturers can already prepare
their whole semester's quizzes and exams, by hand or with an agent.

### Phase B — Students take them

1. ✅ `enrollments` + join code in the student app; course list and Up next on the dashboard.
2. ✅ `attempts` created by the start screen (`learn.startAttempt`), `deadlineAt = min(start +
   timeLimit, closesAt)`; question and option order shuffled per student from a seed (no
   stored order); `responses` autosave (choices at once, typing after a pause).
3. ✅ Quiz player (`kalami/components/quiz`, route `/quizzes/[id]`): start screen with the
   rules, one question per page, navigator, flag for review, server deadline with a
   countdown; the page submits at zero and the cron submits anything left
   (`learn.autoSubmit`, closesAt or deadline + 15 s grace). Code questions inside a quiz
   open the sandbox on their page. Retries follow `attemptsAllowed`; the best score counts.
4. ✅ Auto-grading for single (exact), multiple (exact set, all or nothing) and short
   (trimmed, spaces collapsed, case-insensitive unless set); essays wait for points per
   answer in the lecturer's review (`submissions.setQuestionPoints`), which re-adds the score.
5. ✅ Results per `resultsVisibility`: hidden, score only, or questions + answers + key
   after close ("full, after close" releases nothing, not even the score, until the closing
   time has passed; without one the lecturer releases by setting one).
   ✅ Once a student has started, questions are frozen: text edits keep option ids, anything
   else (add, delete, reorder, reshuffle, change kind) is refused; moving published work back
   to draft or archiving it submits open attempts as they stand.
6. Integrity collector per level ✅ (tasks and quizzes), with short focus losses and long
   sleeps filtered out; the live monitor is still to build.
7. ✅ Notifications (bell + email through Resend) for new work and deadlines; see `OPERATIONS.md`.

### Phase C — Course outline and lessons (core built 2026-10-04)

**Built:** a course is an outline of **weeks** (`weeks` table; "Week N" by default, any
title). A week holds **lessons** (`lessons`, blocks stored on the lesson), **materials**
(one Drive folder and any number of links, on the week itself) and the **tasks and
quizzes** placed in it (`assessments.weekId`). Midterms and finals stay in the course's
Exams section. Weeks and lessons are draft/published; publishing a week publishes its
draft lessons and shares its Drive folder. Backend: `convex/model/weeks.ts`,
`convex/model/lessons.ts`, API in `weeks.ts`, `lessons.ts`; the student reader is
`lessons.read`. Agents: 17 new MCP tools (`get_course_outline`, `create_week`,
`create_lesson`, `add_lesson_blocks`, `place_assessment`, …), drafts only, no Drive
folders. MCP 0.6.0 added `update_course` (draft courses), `delete_assessment`
(untouched drafts), `update_week_link`, `reorder_week_links`, `reorder_lessons`;
agents may reorder around published weeks and lessons but never change their
order, and can't delete a week holding lessons the lecturer published. Course
deletion (owners/admins, web only) is `courses.remove` + batched `courses.purge`
(`model/coursePurge.ts`). The old `materials` table is migrated by `migrations.materialsToWeeks` (an
hourly cron until every deployment is empty, then both go).

Blocks built now: `text`, `callout` (tip/definition/warning/note), `code` (live
HTML/CSS preview in the sandbox iframe), `image` (alt required), `video`
(YouTube/Vimeo embed), `steps` (one at a time), `check` (ungraded self-check). One
renderer, `components/lessons/LessonBlocks.tsx`, serves the staff preview and the
student reader (synced by `sync:student`). Each block slides in on scroll;
`prefers-reduced-motion` turns it off.

**Still to do:** the richer animations below (self-drawing callout borders, typewriter
code, `reveal`, `diagram`), time-on-lesson tracking, scheduled week release.

The original plan, kept for the animation work:

| Block | What the student sees | Animation |
|---|---|---|
| `text` | Markdown paragraph(s) | fade/slide in on scroll |
| `callout` | tip / warning / definition box | hand-drawn border draws itself |
| `code` | code with highlight, optional live preview (HTML/CSS) | typewriter reveal, line highlights step by step |
| `steps` | a numbered sequence, one step at a time | click/tap to advance, previous steps stay |
| `reveal` | bullets that appear one by one | progressive disclosure |
| `diagram` | SVG (boxes, arrows, labels) | stroke animation, parts light up in order |
| `video` | YouTube / Bunny embed | — |
| `check` | one inline question (reuses `questions` + `answerKeys`) | self-drawing tick / red-pen note |

Data: `modules` (week, order) → `lessons` (title, order, status, concepts[]) →
`lessonBlocks` (lessonId, order, type, content JSON). Authoring: a block editor in the
studio plus MCP tools `create_lesson`, `add_lesson_blocks`, `update_lesson_block`, so an
agent can turn a lecturer's slides or notes into an animated lesson. Reader in the student
app honours `prefers-reduced-motion`. Time-on-lesson tracking as in `KALAMI.md` §4.3.

### Phase D — More question types and surveys

Matching, ordering, code tasks (the sandbox from `KALAMI.md` §4.4), surveys (ungraded,
optionally anonymous). Each is a new `type` in `questionInputValidator` and a renderer.

### Phase E — Polish for other lecturers

Course assistants UI, similarity report, "not taught yet" checker, Excel export,
"Generate with AI" button inside the builder (server-side Claude call, same model
functions as MCP).

---

## 6. Running and testing

```bash
# backend + staff app (kalami-stuff)
npm run dev:backend     # convex dev, pushes functions on save
npm run dev             # Next.js on :3101
npm test                # convex-test suite (roles, validation, MCP sign-in)
npm run api:student     # regenerate ../kalami/convex-api/api.ts after backend changes
```

Screens with sample data, no account needed: `/dev/ui` (development only).

Smoke-test the connector with any MCP client (it signs you in). By hand, check discovery:
`/api/mcp` without a token must answer 401 with a `resource_metadata` link, and
`/.well-known/oauth-protected-resource` must name `https://clerk.kalami.space`.

```bash
curl -si https://staff.kalami.space/api/mcp -X POST | grep -i www-authenticate
curl -s https://staff.kalami.space/.well-known/oauth-protected-resource
```
