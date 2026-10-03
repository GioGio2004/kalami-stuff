# Kalami Studio — course creation plan

> How lecturers build quizzes, midterms, finals and (later) animated lectures, by hand or
> through their own AI agent. Companion to `KALAMI.md`; this file is the working plan for
> the staff app (`kalami-stuff`, anticheat.kalami.space) and the backend it owns.

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
| Agents page: personal tokens + setup snippets per client | ✅ | `/agents` |
| Audit log of every change, marked web or agent | ✅ | `convex/audit.ts` |
| Access: lecturers, university admins, super admin only | ✅ | `convex/lib/access.ts` |
| Tests for roles, validation and the token flow | ✅ | `convex/studio.test.ts` |

**Deliberately not built yet:** lectures/lessons (see Phase C), the student side of
assessments (Phase B), matching/ordering/code questions, surveys, course assistants UI.

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
mcpTokens      userId, name, tokenHash (SHA-256), prefix, lastUsedAt?, revokedAt?
auditLog       actorId, via (web|mcp), action, targetTable, targetId, courseId?, summary, at
users          + studioIntroSeenAt?
```

Defaults by kind: quizzes get standard integrity and full results after close; midterms and
finals get strict integrity, one attempt, and a 60/90-minute timer. Lecturers can change all
of it.

---

## 4. The MCP connector

**Endpoint:** `https://anticheat.kalami.space/api/mcp` (Streamable HTTP, stateless).
**Auth:** `Authorization: Bearer klm_…` personal token, created on `/agents`. The token is
hashed in Convex on every call; revoking it stops the agent on its next call.

| Tool | Does |
|---|---|
| `whoami` | who the token acts for, their roles, the universities they can create in |
| `list_courses`, `get_course`, `create_course` | courses the person can edit |
| `create_assessment`, `update_assessment`, `get_assessment` | drafts; settings; questions with keys |
| `add_questions` (≤ 50 per call), `update_question`, `delete_question`, `reorder_questions` | the heavy lifting |

Not exposed on purpose: publish, archive, delete, anything about students, attempts or
grades. The server's `instructions` tell the agent to ask the lecturer to review and
publish in the dashboard.

Client recipes (also shown on `/agents` with the real token filled in):

```bash
# Claude Code
claude mcp add --transport http kalami https://anticheat.kalami.space/api/mcp \
  --header "Authorization: Bearer klm_…"
```

```json
// Cursor (.cursor/mcp.json)
{ "mcpServers": { "kalami": { "url": "https://anticheat.kalami.space/api/mcp",
                              "headers": { "Authorization": "Bearer klm_…" } } } }
```

Claude Desktop goes through `mcp-remote` with the same `--header`. VS Code uses
`.vscode/mcp.json` with `"type": "http"`.

**Later:** OAuth sign-in for clients that can't send headers (claude.ai web connectors).
Clerk can act as the authorization server; `mcp-handler` already serves the RFC 9728
metadata. Also: a rate limit per token (`@convex-dev/rate-limiter`) before the pilot
opens to other lecturers.

---

## 5. Roadmap

### Phase A — Assessments + agents (done, this session)

Everything in section 1. Ships without the student side; lecturers can already prepare
their whole semester's quizzes and exams, by hand or with an agent.

### Phase B — Students take them

1. `enrollments` + `courses.join(joinCode)` in the student app; course list on the
   student dashboard.
2. `attempts` (server-created, `deadlineAt = min(now + timeLimit, closesAt)`, shuffled
   `questionOrder`) and `responses` (autosave every 3 s after typing stops).
3. Student player: start screen with rules, one question per page, navigator, flag for
   review, server timer, scheduled auto-submit.
4. Auto-grading for single / multiple / short; grading queue with red-pen notes for essays.
5. Results per `resultsVisibility`. Lock editing of an assessment once it has attempts
   (today only *archived* is read-only).
6. Integrity collector per level (from `KALAMI.md` §6) and the live monitor.

### Phase C — Lectures with animations

The goal from the brief: lessons that are easier to follow than a PDF because things
*happen* on the page. Plan it as **blocks**, not a document, so both the editor and an
agent can build a lesson piece by piece:

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
npm test                # convex-test suite (roles, validation, MCP tokens)
npm run api:student     # regenerate ../kalami/convex-api/api.ts after backend changes
```

Screens with sample data, no account needed: `/dev/ui` (development only).

Smoke-test the connector with any MCP client, or by hand:

```bash
curl -s https://anticheat.kalami.space/api/mcp -X POST \
  -H "Authorization: Bearer klm_…" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```
