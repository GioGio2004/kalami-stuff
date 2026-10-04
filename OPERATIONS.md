# Operating Kalami

What has to be set where, how email goes out, how to deploy without landing on
an exam, and what to do when something fails. Companion to `STUDIO.md` (the
studio and the MCP connector) and `../kalami/AUDIT-2026-10-04.md` (why these
rules exist).

## Settings

Values are never in the repos. Names only:

| Where | Name | What |
|---|---|---|
| Convex (dev and prod) | `CLERK_FRONTEND_API_URL` | The Clerk Frontend API this deployment trusts |
| Convex | `CLERK_WEBHOOK_SECRET` | Signs Clerk's `user.*` webhooks |
| Convex + Vercel staff | `MCP_SERVICE_SECRET` | Signs the MCP service credential and the unsubscribe links. **Use different values on dev and prod.** |
| Convex | `RESEND_API_KEY` | Sending email. Without it, nothing is sent and nothing fails. |
| Convex | `RESEND_WEBHOOK_SECRET` | Resend's delivery events (bounces, complaints). Optional but recommended. |
| Convex | `EMAIL_FROM` | Defaults to `Kalami <notifications@kalami.space>`; must be on the verified domain |
| Convex | `EMAIL_REPLY_TO` | Optional reply address |
| Convex | `STUDENT_APP_URL` | Links in emails; defaults to `https://app.kalami.space`. Set it on dev to the dev URL. |
| Convex | `STAFF_APP_URL` | Links in message emails to staff; defaults to `https://staff.kalami.space`. Set it on dev to the dev URL. |
| Convex | `RESEND_TEST_MODE` | `true` to only allow Resend's test addresses (dev) |
| Convex | `CLERK_SECRET_KEY` | The Clerk secret key of the same Clerk instance (dev key on dev, live key on prod). Only for Google Drive materials: Convex asks Clerk for the lecturer's Google token. Without it Drive weeks are refused and links still work. |
| Convex | `CODE_ASSET_URL_PREFIX` | The Kalami ImageKit endpoint, with a trailing slash, e.g. `https://ik.imagekit.io/kalami/`. Without it any ImageKit account passes. |
| Vercel (both apps) | `NEXT_PUBLIC_CODE_ASSET_URL_PREFIX` | Same value as above: the preview's CSP allows images from it |
| Vercel staff | `MCP_OAUTH_AUDIENCE` | Optional: `https://staff.kalami.space/api/mcp` once confirmed that Clerk binds OAuth tokens to it |
| Vercel (both) | `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | As before |
| GitHub secrets (kalami-stuff) | `CONVEX_PROD_DEPLOY_KEY` | Nightly backup (`.github/workflows/backup.yml`) |
| GitHub secrets (kalami-stuff) | `CONVEX_DEPLOY_KEY`, `KALAMI_REPO_TOKEN` | CI sync check: a dev deploy key, and a read token if the student repo is private |

Set a Convex value with `npx convex env set NAME value` (add `--prod` for production), never by pasting it into a file that is committed.

## Email

Students get an email (in their language) when work is published to a course
they joined, 24 hours before it closes and 1 hour before, unless they switched
emails off under the bell or clicked the link in an email. One email per
notification row, never twice (`notification:<id>` idempotency key).

Deliverability checklist, all in place or one setting away:

1. Domain verified in Resend: SPF (the `send` subdomain) and DKIM (`resend._domainkey`) — done.
2. DMARC: `_dmarc.kalami.space` is `v=DMARC1; p=none;`. Add `rua=mailto:<your address>` to get reports, and after a few weeks of clean sending move to `p=quarantine`.
3. From a real, verified address with a stable name (`Kalami <notifications@kalami.space>`).
4. Every email carries `List-Unsubscribe` and `List-Unsubscribe-Post` (one-click), a plain-text part, no link shorteners, no tracking pixels.
5. Bounces and spam complaints stop further emails to that address (`users.emailStatus`). For that to work, create a webhook in Resend at `https://<prod deployment>.convex.site/resend-webhook` for all `email.*` events and set `RESEND_WEBHOOK_SECRET`.
6. Volume: Resend's free plan is 100 emails a day. A 300-student course publishing one quiz exceeds it; the component queues the rest for the next day, so nothing is lost, but reminders arrive late. Resend Pro ($20/month) is the fix.
7. Unsubscribe page: `https://<deployment>.convex.site/email/unsubscribe` (served by the backend, signed links, nothing to configure).

## Messages (the contact card)

Students write from the contact card ("Something wrong? Let's bother someone :))")
to one of their lecturers (resolved from their courses and groups, never a typed
address) or to Admin, which means **every super admin**: they share the Kalami
team inbox, and the student sees answers as coming from "Kalami team". Before a
pilot, make sure someone actually reads it.

* Each message is saved in Kalami first; email is only a notice. Staff get the
  message text in the email with a "Reply in Kalami" button (replying to the email
  reaches nobody). Students get a short "X replied" email without the text, and
  no email if they switched emails off.
* Several messages from the same side within 5 minutes send one email.
* Privacy: only the student, the chosen lecturer, and (for team messages) super
  admins can open a conversation. University admins can't, and super admins can't
  open lecturer conversations.
* Retention: resolved conversations are deleted one year after they were
  resolved (daily cron, `RETENTION_MS` in `convex/model/messages.ts`). Open ones
  stay. A deleted student account deletes the conversations it started.
* Not built yet: push notifications (needs the PWA), replying by email,
  reassigning a conversation to someone else, attachments.

## Google Drive materials

Materials live on a course's weeks (see STUDIO.md, Phase C): each week can have one Drive
folder and any number of links. Lecturers connect Drive with the Google account already on their Kalami (Clerk)
login; Kalami asks Google for one extra permission, `drive.file` (only files and
folders Kalami creates). Kalami makes a private course folder with one folder per
week in the lecturer's Drive; publishing a week shares that folder as "anyone with
the link can view", unpublishing takes it back. Files never pass through Kalami.

Setup, once per Clerk instance:

1. The Google login in Clerk must use **your own** Google OAuth client (Clerk's
   shared dev credentials can't ask for extra permissions). Production has one.
   For dev, add the same client to the dev instance (Clerk dashboard → SSO
   connections → Google → custom credentials) and add the dev redirect URI Clerk
   shows to the client in Google Cloud.
2. In that Google Cloud project: enable the **Google Drive API**, and on the OAuth
   consent screen (Data access) add the scope
   `https://www.googleapis.com/auth/drive.file`. It is a non-sensitive scope: no
   security assessment, but the consent screen must be published (In production).
3. Set `CLERK_SECRET_KEY` on the Convex deployment (see Settings).

Troubleshooting: the week row shows Google's problem in words (connection
expired, folder trashed, organisation blocks link sharing, Drive full) with a
Retry button. Busy Google is retried by itself a few times.

Adding a folder to an already published week also shares it once creation
finishes. If an older published week has a private folder, use Retry on that
week; do not unpublish and republish all its lessons just to repair sharing.

### Prepare reading files from existing lessons

The admin script `scripts/prepare-reading-files.mjs` exports one Markdown reading
file per week from the existing lesson blocks, preserving code examples. It does
not generate new teaching content or export assessments, student data or exercise
answer keys. Run with Node 24 from this repository:

```powershell
node --experimental-transform-types scripts/prepare-reading-files.mjs <courseId> <outputDirectory>
```

Review the local files, then repeat with `--upload`. The script uses the production
course owner's existing Google connection. Published lessons go into their already
shared week folders; drafts go into a separate private `Draft reading files` folder
under the course folder. Draft exports are not automatically released when a week
is later published: rerun the export to put its current published lessons in its
shared week folder. These are Markdown files, not native Google Docs or PDFs.

The upload verifies downloaded content and sharing permissions. Identical content
in the same destination is reused on rerun; changed content creates a new snapshot
and leaves older files intact. This is an admin maintenance tool, not a new public
MCP permission or an automatic sync. Google upload protocol reference:
https://developers.google.com/workspace/drive/api/guides/manage-uploads

## Data migrations

`convex/migrations.ts` holds one-off data moves, each idempotent and batched. Right now:
`materialsToWeeks` (the old per-week `materials` rows become `weeks`). It runs hourly
from crons.ts, so a deploy needs nothing by hand; to run it at once:
`npx convex run migrations:materialsToWeeks --prod`. Once it returns 0 on every
deployment, remove the cron, the function and the `materials` table.

## Deploying

* Never deploy while an exam runs. `scripts/predeploy.mjs` asks production whether a timed attempt is in progress or work closes within two hours with students still on it, and exits non-zero if so. Vercel build command for the staff project:
  `node scripts/predeploy.mjs && npx convex deploy --cmd "npm run build"`
  `FORCE_DEPLOY=1` skips the check.
* Backend first, then the student app: a schema or function change must be live before the student bundle that uses it.
* After backend changes run `npm run sync:student` here and commit the result in `../kalami`; CI fails if it is forgotten.

## Backups

`.github/workflows/backup.yml` exports production every night (01:00 UTC) and
keeps 30 days of artifacts. Before any migration or bulk change, export by hand:
`npx convex export --prod --path kalami-before.zip`. Restore with
`npx convex import --prod --replace-all <file>`.

## When things fail

* **"Grading failed" on a submission**: automatic grading threw or ran out of time (a page over the size caps, a bug). The attempt is submitted with score 0 and the error; grade it by hand in the review screen. The cron never retries an attempt more than three times.
* **A student says an answer was lost**: the player keeps unconfirmed answers in the tab (sessionStorage) and retries on its own; Submit refuses while anything is unconfirmed unless they chose "Submit without them". Ask whether they saw that dialog. Saves land for 15 s after a closing time or time limit.
* **Emails not arriving**: check `RESEND_API_KEY` on that deployment, the Resend dashboard (Emails), and the student's `emailOptOut`/`emailStatus` in the `users` table.
* **Rate limited**: every student mutation has a per-person budget (`convex/lib/limits.ts`). Honest use never hits it; a client that does gets `RATE_LIMITED` with `retryAfterMs` and the player backs off by itself.
* **Results not showing**: "Full, after close" releases nothing until the closing time has passed. Set one to release.
