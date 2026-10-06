"use client";

import { useState } from "react";
import { Card, CardTitle, EmptyNote, PanelHeader, StatTile } from "@/components/admin/panel/ui";
import type { SystemInfo } from "@/components/admin/types";
import { Button } from "@/components/ui/buttons";
import { FormError } from "@/components/ui/form";
import { Pill } from "@/components/ui/Pill";
import { WritingDots } from "@/components/ui/StatusScreen";
import { errorMessage } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";

export function SystemView({ system, onAllowEmail }: { system: SystemInfo | undefined; onAllowEmail: (email: string) => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <PanelHeader
        note="Platform"
        title="System"
        description="Whether it's safe to deploy, whether Kalami can send email, who it has stopped emailing, and the jobs running in the background."
      />
      {system === undefined ? (
        <div className="flex justify-center py-16">
          <WritingDots label="Loading" />
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Deploying now"
              value={system.deploy.busy ? "Wait" : "Safe"}
              tone={system.deploy.busy ? "lime" : "ink"}
              note={system.deploy.reason}
            />
            <StatTile label="Attempts in progress" value={system.attemptsInProgress} note="Students working right now" />
            <StatTile
              label="Email"
              value={system.email.configured ? "On" : "Off"}
              note={system.email.configured ? "RESEND_API_KEY is set" : "Set RESEND_API_KEY on the Convex deployment to send invitations and notifications"}
            />
            <StatTile
              label="Migration"
              value={system.migration.materialsLeft === 0 ? "Done" : system.migration.materialsLeft}
              note={system.migration.materialsLeft === 0 ? "Every materials row has become a week" : "Legacy materials rows still to move into weeks"}
            />
          </div>

          <Card>
            <CardTitle count={system.email.suppressions.length}>Addresses Kalami stopped emailing</CardTitle>
            <p className="mt-1 text-sm text-graphite">
              Bounced or marked Kalami as spam, as Resend reported it, or unsubscribed from a message sent before they had an account.
              Allowing one again removes the mark, for the account too.
            </p>
            {system.email.suppressions.length === 0 ? (
              <div className="mt-4">
                <EmptyNote>Every address can be emailed.</EmptyNote>
              </div>
            ) : (
              <ul className="mt-3 divide-y divide-line">
                {system.email.suppressions.map((row) => (
                  <li key={row._id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-3 text-sm">
                    <div className="min-w-0 flex-1 basis-56">
                      <p className="truncate font-medium">{row.email}</p>
                      <p className="text-xs text-graphite">
                        {row.name ?? (row.userId ? "An account without a name" : "No account")} · since {formatDateTime(row.at)}
                      </p>
                    </div>
                    <Pill tone="red">
                      {row.status === "bounced" ? "Bounced" : row.status === "complained" ? "Marked as spam" : "Unsubscribed"}
                    </Pill>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === row.email}
                      onClick={async () => {
                        setBusy(row.email);
                        setError(null);
                        try {
                          await onAllowEmail(row.email);
                        } catch (caught) {
                          setError(errorMessage(caught));
                        } finally {
                          setBusy(null);
                        }
                      }}
                    >
                      {busy === row.email ? "Allowing…" : "Allow again"}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {error && (
              <div className="mt-3">
                <FormError>{error}</FormError>
              </div>
            )}
          </Card>

          <Card>
            <CardTitle count={system.scheduledJobs.length}>Scheduled jobs</CardTitle>
            <ul className="mt-3 divide-y divide-line">
              {system.scheduledJobs.map((job) => (
                <li key={job.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-sm">
                  <span className="min-w-0 flex-1 basis-56 font-medium">{job.name}</span>
                  <span className="text-graphite">{job.does}</span>
                  <Pill>every {job.every}</Pill>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </>
  );
}
