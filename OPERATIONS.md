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
| Convex | `RESEND_TEST_MODE` | `true` to only allow Resend's test addresses (dev) |
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
