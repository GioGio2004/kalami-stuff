# Google Drive reading documents through MCP

The staff MCP connector now supports native Google Docs in a lecturer's Drive:

- `prepare_week_drive` starts the existing private course/week folder job.
- `list_reading_documents` returns stable keys and links, including unfinished saves.
- `create_reading_document` creates or replaces a reading and attaches its link to a draft week.

## Setup and release

1. Deploy this backend and the staff Next.js application together. The schema change adds `readingDocuments` and an optional week lock; existing rows require no backfill. Generated bindings are included.
2. Keep the existing MCP OAuth configuration. `MCP_SERVICE_SECRET` must match between staff and Convex. The Convex `CLERK_SECRET_KEY` must belong to that Clerk instance.
3. Enable Google Drive API in the Google project used by Clerk. Connect Google in the staff app and grant the existing `https://www.googleapis.com/auth/drive.file` scope. No additional scope, Google Docs API, or agent-held Google credentials are needed.
4. Refresh/reconnect the assistant's Kalami MCP connection if its tool list is cached.

The account using the tools must be a course editor and the course's Drive owner. The first folder preparation establishes a Drive owner if the course has none. Other lecturers cannot use that person's Google token.

## Agent workflow

Read the course outline. For a draft week without a folder, call `prepare_week_drive`, then inspect `get_course_outline` until `drive.url` exists, `drive.syncing` is absent and `drive.error` is absent. If folder creation fails, report the error; retry preparation after addressing the connection problem.

Call `list_reading_documents` before adding a reading. Use an existing key to revise that reading. Example `create_reading_document` input:

```json
{
  "weekId": "<week id from the outline>",
  "documentKey": "html-introduction",
  "title": "HTML — reading before class",
  "content": "# What HTML does\nHTML describes the structure of a page.\n\n# Try it\n- Identify the heading.\n- Find a paragraph.\n\n```html\n<h1>Hello</h1>\n<p>My first page.</p>\n```"
}
```

Headings, bullet lists and fenced code are formatted through a safe HTML import into a native Google Doc. Raw HTML is escaped; other Markdown syntax is literal. Limit: 200 title characters, 100,000 content characters, 80 characters in the stable key. Unicode text is supported.

Reuse `documentKey` for revisions and retries. Updating **replaces the entire document**, including manual Google Docs edits, while preserving the URL. A new key means a new document. Published weeks must be unpublished by a person before revisions. A fresh draft week is another option.

## Privacy and recovery

New files start in My Drive, privately, and move into the private week folder after their content is saved. Actual file and folder permissions are checked, including the course folder. Externally shared draft folders/files are refused. Publishing the week uses Kalami's existing folder sharing; the agent cannot publish. Sharing changed directly in Google remains under the Drive owner's control.

Writes serialize per week. Publishing, deleting the week, changing its links and moving its Drive are blocked during a save. If an action terminates without releasing its claim, it expires after eleven minutes, longer than Convex's maximum action runtime.

The backend persists the Google file ID before uploading content. If a creation response is lost, the next call searches the file's private Kalami tag. It never blindly repeats an ambiguous creation. If Google still cannot find that file, retry later with the same key. A persistent unknown outcome requires support to inspect the row and Google Drive before resetting `createAttempted`; do not switch keys merely to bypass it. Definitive rejected creations can be retried normally. Failed content uploads keep the private file for recovery.

Removing a week/course clears Kalami tracking records, while Google files remain owned by the lecturer, matching existing folder behavior. The tool does not read arbitrary Drive files or edit documents it did not create.

## Verification

Automated tests use an in-memory Convex backend and mocked Clerk/Google HTTP responses. They cover creation, updating the same ID, listing keys, preparing folders, publication visibility, lost responses, upload failures, scope and ownership checks, public-folder rejection and concurrent edits.

Before declaring production ready, deploy both services and run one real connected-account smoke test: create a disposable draft week, prepare its folder, create and revise a reading with the same key, inspect formatting/privacy in Drive, then publish and verify student access. Local tests cannot validate the deployed Google/Clerk configuration.

Google's upload-and-convert behavior, including full-content replacement on update: [Drive upload guide](https://developers.google.com/workspace/drive/api/guides/manage-uploads#import_to_google_docs_types).
