# Kalami — Product & Architecture Brief

> **კალამი (kalami) — "pen".** Your own work, written by your own hand.
> A learning and exam platform for universities where students learn, practise and get tested,
> and where cheating is hard to do and easy to see.

Copy this file into both repos (`kalami-anticheat` and `kalami-student`) as the single source of truth.

---

## 1. The idea in one page

**The problem.** Students cheat with AI, shared answers and copy-paste, and the lecturer can't see it.
Existing tools are ugly, English-only, and expensive, and most Georgian universities don't have one at all.

**What Kalami is.**

- **For students:** a calm, beautiful, handwritten-style place to read lessons, practise and take quizzes and exams.
  Code tasks have a live HTML/CSS sandbox.
- **For lecturers (Kalami AntiCheat):** a studio to build courses, quizzes and exams, and a live control room
  that shows who is working, who is struggling, and who is probably cheating.
- **For the university (later):** one platform for every faculty, in Georgian, with clear evidence about learning and honesty.

**The rule underneath everything:** *every line is typed by hand.* No paste, no copying tasks out, no hiding.

**What makes it different:**

1. Anti-cheating built into every screen, not bolted on.
2. A Georgian-first, handwritten design that students actually like opening.
3. A live view of the whole class for lecturers, in real time.
4. Per-student task variants, so copying a friend's work doesn't work.
5. Later: lecturers can build courses by talking to their AI assistant (MCP).

**What Kalami is NOT (on purpose):**

- No screen or session recording, webcam or microphone.
- No AI access for students. The AI connector is for lecturers only.
- No automatic punishment. The system flags; the lecturer decides.

---

## 2. Products, domains, repos

```
kalami.space                  → landing page (what Kalami is, contact)
app.kalami.space              → STUDENTS        repo: kalami-student    (Vercel project #2)
anticheat.kalami.space        → LECTURERS/ADMIN repo: kalami-anticheat  (Vercel project #1, owns convex/)
```

```
┌───────────────────────────┐            ┌────────────────────────────┐
│  kalami-anticheat (repo)  │            │  kalami-student (repo)     │
│  Next.js staff app        │            │  Next.js student app       │
│  convex/  ◀ THE BACKEND   │            │  convex-api/api.ts         │
│  deploys Convex + Vercel  │            │  (generated, copied over)  │
└────────────┬──────────────┘            └─────────────┬──────────────┘
             └─────────────── same ──────────────────────┘
                     ONE Convex deployment (one database)
                     ONE Clerk instance (one login across *.kalami.space)
```

| | kalami-anticheat | kalami-student |
|---|---|---|
| Users | lecturers, assistants, university admins, super admin | students |
| Owns backend | ✅ `convex/` | ❌ connects to the same Convex URL |
| Integrity layer | ❌ normal copy/paste (lecturers need it) | ✅ all restrictions |
| Security | staff-only middleware + Clerk 2FA required | student middleware |
| Build | `npx convex deploy --cmd 'npm run build'` | `npm run build` |

### Keeping the student repo typed

After changing the backend, run this in **kalami-anticheat**:

```bash
npx convex-helpers ts-api-spec
```

Copy the generated file into `kalami-student/convex-api/api.ts`. The student app then has full types for every function.
Later, a GitHub Action can open a PR in the student repo automatically.

### Rules between the repos

1. **Additive backend changes only.** Never rename or remove a function the student app uses.
   Add the new one, ship the student app, then delete the old one.
2. **Deploy order:** backend (anticheat) first, then student.
3. **No backend deploys during exams.** A pre-deploy script refuses to deploy while any exam attempt is `in_progress`.
4. **Every Convex function checks the role on the server.** Subdomains are a fence; the role check is the lock.

---

## 3. Users and roles

| Role | Lives on | How they get it | Can do |
|---|---|---|---|
| **Student** | app. | Signs up, joins a course with a **join code** or link | Learn, practise, submit work, take quizzes, exams and surveys |
| **Lecturer** | anticheat. | **Email invite** from you or a university admin | Create and own courses; manage students; build assessments; grade; monitor live |
| **Assistant** | anticheat. | Added to one course by its lecturer | Grade and monitor that course only |
| **University admin** | anticheat. | Appointed by super admin | Invite lecturers; university-wide stats |
| **Super admin** | anticheat./admin | You | Everything, across all universities |

Identity comes from Clerk; **roles live in Convex** (`memberships`, `courseStaff`).
Never trust a user ID sent from the browser. Always derive the user from `ctx.auth.getUserIdentity()`.

---

## 4. The student experience (app.kalami.space)

### 4.1 Sign-up and onboarding

1. Sign up with Clerk (email or Google).
2. Onboarding (one handwritten "notebook page" form): first and last name (Georgian), university, faculty, group, year,
   student ID (optional), language (ქართ / EN).
3. Read and accept the **honesty notice**: what is tracked and why, in plain words. This is required.
4. Enter a **join code** (or open a `/join/ABC123` link) → enrolled.

### 4.2 Dashboard

- "My notebook": course cards with a progress line drawn like a pen stroke.
- **Up next:** the next lesson and the nearest deadlines.
- **Open now:** quizzes and exams that are currently open, with countdowns.
- Recent grades and lecturer feedback, shown as "red pen" notes.

### 4.3 Course and lessons

- Course page: modules (weeks), each with lessons, tasks and quizzes in order. Locked items show when they open.
- Lesson reader: clean, readable body text; handwritten headings; code blocks; images; embedded YouTube.
- **Time tracking:** counts only while the tab is visible and the student is active (scrolled, typed or moved in the last 60s).
  Sent to the server every 30s.
- "Mark as done" at the end, plus an optional "I'm confused" button that anonymously notifies the lecturer which lesson is hard.

### 4.4 Tasks (code sandbox)

```
┌──────────── Task: "Build your profile card" ─────────────┐
│ Instructions (watermarked with student name)              │
├───────────── index.html | style.css ──────┬──────────────┤
│ CodeMirror editor                           │ Live preview │
│ (no paste, no autocomplete)                 │ (iframe)     │
├─────────────────────────────────────────────┴──────────────┤
│ Checks: ✓ has <nav>   ✓ 3 <li>   ✗ .card uses display:flex │
│ [Run checks]                                   [Submit]    │
└────────────────────────────────────────────────────────────┘
```

- Files: `index.html` and `style.css` (JS later).
- Preview: `<iframe srcdoc sandbox>` with **no scripts allowed** in the HTML/CSS phase, so it is completely isolated.
- **Checks** give instant feedback while practising and are re-run on the server on submit.
- **Variant:** each student gets their own values (colours, texts, counts) generated from `studentId + assessmentId`.
- Autosave 3s after typing stops; work survives refresh and reconnects.
- After submit, the code is read-only and the lecturer's red-pen feedback appears when graded.

### 4.5 Quizzes and exams

- Start screen: rules, time limit, integrity level, "I understand" → **Start**.
- Strict exams require **fullscreen** first.
- Question types: single choice, multiple choice, short answer, essay, matching, ordering, code.
- One question per page or all on one page (lecturer's choice); a question navigator; "flag for review".
- Timer from the **server** deadline; auto-submit when time runs out (done by the server even if the browser is closed).
- Results according to lecturer settings: hidden, score only, or score + correct answers after close.

### 4.6 Surveys

The same player with no grading, optionally anonymous. Used for course feedback and for **your pilot evidence**.

### 4.7 Profile

Name, avatar, group, language, honesty notice (re-readable), "my activity" (their own time-spent stats).
Transparency builds trust.

---

## 5. The lecturer experience (anticheat.kalami.space)

### 5.1 Courses home

All my courses, with a quick status per course (students, active now, pending grading, open assessments).
Create course → title, description, semester, language → a join code is generated (can regenerate or disable).

### 5.2 Course studio

- Left: the course tree (modules → lessons, tasks, quizzes, exams, surveys), drag to reorder.
- Centre: the editor for the selected item.
- Everything is **draft → published**. Students only see published items, and only within their open dates.
- **Lesson editor (Tiptap):** headings, text, lists, code blocks, images (Convex storage), YouTube embeds, callouts.
  Each lesson lists the **concepts it teaches** (e.g. `flexbox`, `<nav>`) for the "not taught yet" checker.
- **Assessment builder:** settings (kind, dates, time limit, attempts, shuffle, integrity level, results visibility)
  plus a list of questions with a type picker.
- **Code task builder:** starter files, instructions, variant parameters, check rules, points per check.

### 5.3 Students

Roster with progress %, total time spent, last active, average score and integrity colour.
Click a student → timeline of lessons, time, attempts, grades and flags. Export to Excel.

### 5.4 Live monitor (the "control room")

During any open assessment:

```
Ana B.      ● online   Q7/20   ████████░░   🟢  0 flags
Giorgi K.   ● online   Q3/20   ███░░░░░░░   🟡  away 42s · 3 tab switches
Nino M.     ○ offline  —       —            🔴  left fullscreen ×2 · attempt LOCKED  [Unlock]
```

- Real-time (Convex subscriptions) with no refresh.
- Sort by flags, progress or name; filter to "needs attention".
- Actions: unlock an attempt, add time to one student, send a message to all, end the exam early.

### 5.5 Grading and results

- Auto-graded questions are scored instantly; essays and code go to a grading queue.
- **Red-pen grading:** highlight lines in a student's code or essay and leave a handwritten-style note.
- Integrity report per attempt: score, flags and reasons (with a timeline of events).
- **Similarity report** after close: pairs of students with suspiciously similar code.
- Statistics per question (how many got it right) to spot bad questions.

### 5.6 Admin (super admin and university admin)

Universities, faculties, lecturer invites, usage stats (active students, time spent, assessments run).
These stats are your **pitch numbers**.

---

## 6. The integrity system ("AntiCheat")

### 6.1 Integrity levels (set per assessment)

| Restriction | `off` (practice) | `standard` | `strict` (exams) |
|---|:-:|:-:|:-:|
| No paste or drop in the editor; can't copy task text; no right-click | ✅ | ✅ | ✅ |
| No autocomplete | ✅ | ✅ | ✅ |
| Watermark with the student's name | | ✅ | ✅ |
| Tab and focus tracking with time away | | ✅ | ✅ |
| One tab only + one active session | | ✅ | ✅ |
| Typing anomaly detection | | ✅ | ✅ |
| Fullscreen required; leaving it pauses and is logged | | | ✅ |
| Content hidden while the window is out of focus | | | ✅ |
| Auto-lock after limits (e.g. 3 exits or 60s away) | | | ✅ |
| Blocked shortcuts (copy/paste/print/view source/devtools keys) | ✅ | ✅ | ✅ |

### 6.2 Signals collected (counters, not recordings)

| Signal | How it is detected |
|---|---|
| `tabSwitches`, `awayMs` | `visibilitychange` + `blur`/`focus` |
| `fullscreenExits` | `fullscreenchange` |
| `pasteBlocked`, `copyBlocked`, `dropBlocked` | intercepted events |
| `largeInserts` | a single editor change inserting > ~50 characters |
| `fastTypingBursts` | sustained typing faster than a human threshold |
| `resizes` | window shrinking (split-screen) |
| `multiTab` | a second tab of the app opened (BroadcastChannel) |
| `devtoolsSignals` | heuristics (weak, logged only) |
| `printScreen` | PrintScreen key while focused (Windows) |
| `sessionConflict` | the same account active somewhere else |

### 6.3 Pipeline

```
Browser collector  ──(one batched mutation every 15s, plus immediately for serious events)──▶
    integritySummary (counters, score, flags)  ← live monitor reads only this
    integrityEvents  (detailed, capped ~300 per attempt, archived after the semester)
```

### 6.4 Integrity score (example weights, tune in the pilot)

```
score = 3·fullscreenExits + 2·tabSwitches + 1 per 10s away + 4·largeInserts
      + 3·fastTypingBursts + 1·pasteBlocked + 5·multiTab + 5·sessionConflict
🟢 0–5   🟡 6–15   🔴 16+
```

The colour is advice, not a verdict. The lecturer sees the reasons and decides.

### 6.5 After-submission detection

- **"Not taught yet":** flags code using tags or properties that no lesson so far has taught.
- **Time versus output:** a lot of code in very little time on the task.
- **Similarity:** normalised code is compared across all submissions of an assessment.
- **Skill jump:** a big difference from the student's own earlier work (Phase 2).

### 6.6 Honest limits (say these out loud in the pitch)

A browser can't block screenshots or other apps, and nothing on a computer stops a phone.
Kalami makes cheating **annoying, visible and pointless**: per-student variants, live monitoring, oral spot checks,
and later the desktop exam app.

---

## 7. Design direction: "handwritten notebook"

**Feeling:** a good notebook and a good pen. Warm, calm, personal, not childish.

| Element | Direction |
|---|---|
| Background | Off-white paper (light) / dark slate "chalkboard" (dark); subtle paper grain |
| Ink | Deep ink-blue as the main colour; **red pen** for lecturer marks and errors; graphite grey for secondary text |
| Headings and accents | A handwritten font. Most Google handwriting fonts have **no Georgian letters**: find or commission a Georgian handwritten font, or draw the key words (logo, page titles) as SVG |
| Body text | A clean, very readable font with good Georgian support (e.g. Noto Sans Georgian). **Never handwritten for long text** |
| Shapes | Slightly imperfect, hand-drawn borders and underlines (e.g. rough.js for sketchy boxes) |
| Motion | Ticks, underlines and circles **draw themselves** (SVG stroke animation); progress bars fill like ink |
| Icons | Hand-drawn line icons |
| Logo | A pen nib or a pen stroke forming "კ" / "K" |
| Staff side | Same family but more "instrument": tighter, more data-dense, with handwriting reserved for accents and red-pen grading |
| Accessibility | Good contrast, real text (not images), keyboard navigation, respects reduced motion |

Signature moments: the red-pen grading notes, the self-drawing check marks in the task checks, the notebook-page onboarding,
and the ink-filling progress lines.

---

## 8. Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js (App Router) + TypeScript, in both repos |
| Backend / DB | Convex (one deployment, lives in kalami-anticheat) |
| Auth | Clerk (one instance; sessions shared across `*.kalami.space`); 2FA required for staff |
| UI | Tailwind + shadcn/ui, restyled to the notebook look |
| Code editor | CodeMirror 6 |
| Lesson editor | Tiptap (JSON; Markdown import/export for AI later) |
| i18n | Own dictionaries, Georgian + English (copied in both repos) |
| Email | Resend (invites, deadline reminders) |
| Files | Convex storage (images); YouTube or Bunny Stream for video |
| Archive | Cloudflare R2 for old semesters' raw events |
| Hosting | Vercel (two projects). Move to Pro once it is sold (Hobby plan is non-commercial) |

---

## 9. Data model (Convex)

Every record is reachable from a `universityId` (directly or through its course).
High-churn data (heartbeats, progress, integrity counters) lives in **separate tables** from stable data.

### Identity and organisation

| Table | Fields | Indexes |
|---|---|---|
| `universities` | name {ka,en}, slug, status | by_slug |
| `users` | tokenIdentifier, email, firstName, lastName, avatarUrl, locale, honestyAcceptedAt | by_tokenIdentifier |
| `memberships` | userId, universityId, role (student/lecturer/uni_admin/super_admin), faculty, group, year, studentNumber | by_userId, by_universityId_and_role |
| `invites` | email, universityId, role, token, invitedBy, expiresAt, acceptedAt | by_token, by_email |
| `sessions` | userId, sessionKey, userAgent, ip, lastActiveAt | by_userId |

### Courses and content

| Table | Fields | Indexes |
|---|---|---|
| `courses` | universityId, ownerId, title, description, semester, locale, status (draft/published/archived), joinCode, joinEnabled | by_universityId, by_ownerId, by_joinCode |
| `courseStaff` | courseId, userId, role (owner/assistant) | by_courseId, by_userId |
| `enrollments` | courseId, userId, status (active/removed), enrolledAt | by_courseId, by_userId, by_courseId_and_userId |
| `modules` | courseId, order, title, opensAt? | by_courseId_and_order |
| `lessons` | courseId, moduleId, order, title, body (Tiptap JSON), status, estMinutes, concepts[] | by_moduleId_and_order |
| `lessonProgress` | userId, lessonId, courseId, timeSpentSec, lastSeenAt, completedAt? | by_userId_and_lessonId, by_courseId |
| `lessonFeedback` | lessonId, courseId, kind ("confused"), at (anonymous) | by_lessonId |

### Assessments

| Table | Fields | Indexes |
|---|---|---|
| `assessments` | courseId, moduleId?, kind (task/quiz/exam/survey), title, instructions, opensAt, closesAt, timeLimitMin?, attemptsAllowed, shuffleQuestions, shuffleOptions, integrityLevel (off/standard/strict), resultsVisibility (hidden/score/full_after_close), anonymous, status | by_courseId, by_moduleId |
| `questions` | assessmentId, order, type, prompt, points, config (options, starter files, variant params) | by_assessmentId_and_order |
| `answerKeys` | questionId, assessmentId, key (correct options / accepted answers / check rules). **Never returned to students** | by_questionId |
| `attempts` | assessmentId, courseId, userId, number, status (in_progress/submitted/auto_submitted/locked/graded), startedAt, deadlineAt, submittedAt?, score?, maxScore, variantSeed, questionOrder[] | by_assessmentId, by_userId_and_assessmentId, by_status |
| `responses` | attemptId, questionId, value, savedAt, autoScore?, manualScore?, feedback? (red-pen notes) | by_attemptId, by_attemptId_and_questionId |

**Question types:** `single` · `multiple` · `short` · `essay` · `matching` · `ordering` · `code` · `rating` · `open` (the last two for surveys).

**Example code check rules** (stored in `answerKeys.key`):

```json
[
  { "id": "nav",   "type": "exists",    "selector": "nav",                 "points": 1, "label": "Has a <nav>" },
  { "id": "items", "type": "count",     "selector": "nav li", "eq": 3,     "points": 1, "label": "3 menu items" },
  { "id": "flex",  "type": "css",       "selector": ".card", "property": "display", "eq": "flex", "points": 2 },
  { "id": "color", "type": "css",       "selector": "h1", "property": "color", "eq": "{{variant.color}}", "points": 1 },
  { "id": "title", "type": "text",      "selector": "h1", "contains": "{{student.firstName}}", "points": 1 }
]
```

### Integrity

| Table | Fields | Indexes |
|---|---|---|
| `integritySummary` | attemptId, assessmentId, userId, counters…, score, level (green/yellow/red), flags[], updatedAt | by_attemptId, by_assessmentId |
| `integrityEvents` | attemptId, type, at, meta | by_attemptId |
| `presence` | userId, courseId, attemptId?, page, lastSeenAt | by_attemptId, by_courseId |
| `similarityFlags` | assessmentId, attemptA, attemptB, similarity | by_assessmentId |

### Platform

| Table | Fields | Indexes |
|---|---|---|
| `auditLog` | actorId, via (web/mcp/ai), action, targetTable, targetId, summary, at | by_targetId, by_actorId |
| `announcements` | courseId, authorId, body, at | by_courseId |
| `courseStats` | courseId, students, activeToday, pendingGrading… (stored counters) | by_courseId |

---

## 10. Pages

### kalami-student (app.kalami.space)

```
/sign-in  /sign-up  /join/[code]
/onboarding
/dashboard
/courses/[courseId]
/courses/[courseId]/lessons/[lessonId]
/assess/[assessmentId]            start screen → player → result
/profile
```

### kalami-anticheat (anticheat.kalami.space)

```
/sign-in  /invite/[token]
/courses                                      my courses
/courses/[courseId]                           studio (tree + editor)
/courses/[courseId]/students                  roster
/courses/[courseId]/students/[userId]         student timeline
/assessments/[assessmentId]/edit              builder
/assessments/[assessmentId]/live              live monitor
/assessments/[assessmentId]/results           grading, integrity, similarity
/admin                                        universities, invites, stats
/api/mcp                                      (Phase 3)
```

---

## 11. Key flows

**Exam lifecycle (server-controlled):**

1. Student presses Start → server checks enrolment, the open window and attempts left → creates the attempt with
   `deadlineAt = min(now + timeLimit, closesAt)`, the shuffled `questionOrder` and the `variantSeed` →
   **schedules an auto-submit at `deadlineAt`**.
2. Questions are returned only for an `in_progress` attempt owned by the caller, without answer keys.
3. Responses autosave (3s after typing stops). On reconnect the attempt resumes with the same deadline.
4. Submit (or the scheduled deadline) → auto-grade → `submitted` / `auto_submitted` → `graded` once manual items are done.
5. Strict level: crossing the lock threshold sets `locked`; only staff can unlock (optionally adding time).

**Lesson time:** active and visible → count → `progress.tick` every 30s (capped so one call can't add more than 30s).

**Similarity:** when an assessment closes, a scheduled job normalises the code (strip whitespace and comments,
rename classes) and compares every pair → `similarityFlags`.

**Archiving:** a monthly cron moves `integrityEvents` of finished semesters to R2.

---

## 12. Folder structure

### kalami-anticheat

```
app/(auth) (staff)/...
components/studio/  monitor/  grading/  ui/
convex/
  schema.ts  auth.config.ts
  lib/auth.ts          requireUser, requireStaff, requireCourseRole
  users.ts universities.ts invites.ts
  courses.ts modules.ts lessons.ts progress.ts
  assessments.ts questions.ts attempts.ts grading.ts
  integrity.ts similarity.ts surveys.ts audit.ts crons.ts
lib/i18n/  lib/checks/  lib/variants.ts
scripts/predeploy-check.ts   refuses to deploy during live exams
```

### kalami-student

```
app/(auth) (student)/...
components/
  integrity/   IntegrityProvider, Collector, Watermark, FullscreenGate, NoPaste
  sandbox/     CodeEditor, Preview, CheckResults
  player/      Player, Timer, Navigator, questions/*
  notebook/    handwritten UI pieces (Scribble, InkProgress, RedPenNote)
convex-api/api.ts            generated in kalami-anticheat, copied here
lib/i18n/  lib/checks/  lib/variants.ts   (same as anticheat)
```

---

## 13. Setting up the repos

### kalami-anticheat (owns the backend)

```bash
npx create-next-app@latest kalami-anticheat
cd kalami-anticheat
npm install convex @clerk/nextjs
npm install -D convex-helpers
npx convex dev
```

- Clerk: create one application, enable the Convex integration, and put the Clerk issuer URL in `convex/auth.config.ts`.
- Wrap the app in `ClerkProvider` + `ConvexProviderWithClerk`.
- Vercel env: `CONVEX_DEPLOY_KEY`, `NEXT_PUBLIC_CONVEX_URL`, Clerk keys.

### kalami-student (client only)

```bash
npx create-next-app@latest kalami-student
cd kalami-student
npm install convex @clerk/nextjs
```

- **Don't** run `convex dev` here. Set `NEXT_PUBLIC_CONVEX_URL` to the same deployment.
- Copy the generated `api.ts` into `convex-api/` and import `api` from there.
- Same Clerk publishable and secret keys.

### Domains (production)

- Buy `kalami.space` (and consider `kalami.ge`).
- `app.kalami.space` → Vercel project kalami-student; `anticheat.kalami.space` → Vercel project kalami-anticheat.
- Clerk production instance on `kalami.space`, so logins work across both subdomains.

---

## 14. Roadmap

### Phase 1: your class (pilot)

| Step | Build | Done when |
|---|---|---|
| 1. Foundation | Both repos, Clerk + Convex auth, `users`, `universities`, `memberships`, role helpers, onboarding, honesty notice, ka/en, base notebook design | A student and a lecturer can sign in on their own subdomain and are blocked from the other |
| 2. Content | Courses, join codes, modules, lessons (studio + reader), time tracking | You publish lecture 1; students join with a code, read it, and you see their time |
| 3. Sandbox and tasks | Editor, preview, check rules (client + server), variants, submit, grading queue, red-pen feedback | Students do a graded HTML/CSS task and you grade it |
| 4. Integrity | Collector, restrictions per level, summaries, flags, live monitor | You watch the class live and see who left the tab |
| 5. Quizzes, exams, surveys | Question types, server timer, scheduled auto-submit, autosave, results, surveys | A full timed exam runs end to end, plus a feedback survey |
| 6. Pilot ready | Load test (100 simulated students in one exam), privacy notice, error monitoring, pre-deploy guard | Launch to your students |

### Phase 2: other lecturers

Lecturer invites, studio polish, similarity checks, "not taught yet", skill jump, Excel export, assistants.

### Phase 3: AI for lecturers

MCP connector at `/api/mcp` (Clerk OAuth, lecturer-only tools, everything lands as drafts, audit-logged), then the
"Generate with AI" button (Claude API) once the university funds it.

### Phase 4: desktop exam app

Electron wrapper of the student app: screenshot blocking, kiosk mode, running-app detection, second-monitor and
VM detection. Graded exams require it.

### Phase 5: the pitch

A second university (Gori State University), university admin panel, pilot numbers, and a live demo for the vice-rector.

---

## 15. Pilot evidence to collect (for the pitch)

- Number of students, lecturers, courses, lessons and assessments run.
- Average time spent learning per student per week.
- Integrity flags raised, and how many the lecturers confirmed.
- Grading time saved (auto-graded items × average minutes).
- Survey results from students **and** lecturers (ease of use, fairness, "would you keep using it?").
- Quotes from lecturers.

---

## 16. Privacy and trust

- Plain-language honesty notice at onboarding: what is tracked (focus, paste attempts, time, typing counters),
  what is **not** (no screen, camera, mic or keystroke recording), who sees it, and how long it is kept.
- Georgian Personal Data Protection law applies: keep a privacy policy and a data processing agreement ready
  for universities.
- Retention: detailed integrity events are archived after the semester and deleted after an agreed period.
- Students can see their own activity stats.
- No student personal data is ever sent to AI tools (MCP exposes course content and anonymous stats only).

---

## 17. Ownership and business (reminder)

- Build on your own time, laptop, GitHub and domain. Check your employment contract; consider a short IP consultation.
- **License, don't transfer:** universities pay to use Kalami; you keep the code.
- Path: free pilot for a semester → annual or per-student license. Register as an individual entrepreneur
  (small business status) before the first contract; public universities may need state procurement (tenders.ge).
- Never promise "impossible to cheat." Promise "the hardest platform to cheat on, where every attempt is visible."
