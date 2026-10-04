# .kalami course files

A `.kalami` file is a whole Kalami course in one file: weeks, lessons, links,
tasks, quizzes and exams (with answer keys). Version 1 is UTF-8 JSON, so people
and AI assistants can write one directly; a later version can become a zip
with bundled images and documents, told apart by the `version` field.

**The authoring guide** (fields, every block and question type, a complete
example, common mistakes) lives in one place, `lib/kalami/guide.ts`, and is
served at:

- https://staff.kalami.space/kalami-format: the guide, as Markdown
- https://staff.kalami.space/kalami.schema.json: the JSON Schema (a file's
  `"$schema"` points here, so editors autocomplete and underline mistakes)
- the MCP tool `get_kalami_format`: both, for AI assistants

A test (`convex/kalami.test.ts`) imports the guide's own complete example, so
the guide can't drift from what Kalami accepts.

## How it works

| Piece | Where |
|---|---|
| Format (zod schema, parsing, signing input, file names) | `convex/lib/kalami.ts` |
| Content shapes shared with the MCP tools (questions, code tasks, blocks, settings) | `convex/lib/contentSchemas.ts` |
| Export, deep checks before import, undoing a failed import | `convex/model/kalami.ts` |
| Import in steps (course, each week with lessons, each assessment) | `convex/model/kalamiImport.ts`, `convex/kalami.ts` |
| Agents: `export_course_file`, `check_kalami_file` (dry run), `import_kalami_file` | `convex/mcp.ts`, `lib/mcp/server.ts` |
| Staff app: Export button (course page), Import dialog + drop anywhere (My courses) | `components/kalami/` |

- **Export** (course editors only: answer keys are inside) builds the file on
  the server and the browser saves it. No students, attempts, grades, groups,
  join codes, ids, dates or Drive permissions are ever in a file.
- **Import** always creates a **new draft course** owned by the importer. The
  whole file is checked first, with the same checks as the web app (format,
  every lesson block, link, question, setting, code task solution); problems
  come back as `course › weeks[1] › lessons[0] › blocks[3] › alt: …`. If a step
  still fails half-way, the half-made course is removed.
- **Verified by Kalami**: exports carry an HMAC signature (`MCP_SERVICE_SECRET`,
  domain-separated by the `kalami-file:v1:` prefix) over the kind, `exported`
  and `course` exactly as written. An unchanged file shows the verified badge
  with who exported it; anything written or edited elsewhere imports fine,
  marked "Not verified". Signatures only verify on a deployment with the same
  secret (prod files on prod).

## Next

- Opening `.kalami` by double-click: the staff app as an installable web app
  (PWA) registering a file handler for `.kalami` (desktop Chrome/Edge).
- Student-side files: practice packs (no answers) and exam launch files.
- Version 2: a zip with bundled images and documents.
