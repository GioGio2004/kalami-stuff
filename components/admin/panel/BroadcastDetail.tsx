"use client";

import { Avatar, EmptyNote, ListFooter, StatTile } from "@/components/admin/panel/ui";
import { ROLE_LABEL, type BroadcastRow, type DeliveryRow, type ListStatus } from "@/components/admin/types";
import { Dialog } from "@/components/ui/Dialog";
import { Check, Cross } from "@/components/ui/icons";
import { Pill } from "@/components/ui/Pill";
import { WritingDots } from "@/components/ui/StatusScreen";
import { formatDateTime } from "@/lib/format";

/** Why someone got no email, as the recipient list says it. */
export const EMAIL_SKIP_LABEL = {
  off: "not chosen",
  opted_out: "switched emails off",
  blocked: "address bounced",
  not_configured: "email not set up",
} as const;

/** One message sent from the notification center: what it said, how far it got, and who got what. */
export function BroadcastDetailDialog({
  broadcast,
  recipients,
  status,
  onLoadMore,
  open,
  onClose,
}: {
  broadcast: BroadcastRow | undefined;
  recipients: DeliveryRow[] | undefined;
  status: ListStatus;
  onLoadMore: () => void;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} label="Message" size="lg">
      <div className="max-h-[85vh] overflow-y-auto p-5 sm:p-8">
        {broadcast === undefined ? (
          <div className="flex justify-center py-16">
            <WritingDots label="Loading the message" />
          </div>
        ) : (
          <>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-graphite">
              {broadcast.from.en} · {formatDateTime(broadcast._creationTime)} · {broadcast.senderName}
            </p>
            <h2 className="mt-2 text-2xl font-medium tracking-tight">{broadcast.title}</h2>
            <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed text-ink/85">{broadcast.body}</p>
            {broadcast.link !== undefined && (
              <p className="mt-3 text-sm text-graphite">
                Link: <span className="break-all font-mono text-[13px] text-ink">{broadcast.link}</span>
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-1.5">
              <Pill tone="ink">To: {broadcast.audienceLabel}</Pill>
              {broadcast.groupName !== undefined && <Pill tone="lime">Invitation to {broadcast.groupName}</Pill>}
              <Pill tone={broadcast.status === "sending" ? "lime" : "panel"}>
                {broadcast.status === "sending" ? "Sending…" : `Sent${broadcast.finishedAt !== undefined ? ` · ${formatDateTime(broadcast.finishedAt)}` : ""}`}
              </Pill>
              <Pill>Bell</Pill>
              {broadcast.channels.push && <Pill>Push</Pill>}
              {broadcast.channels.email && <Pill>Email{broadcast.emailEveryone ? ", everyone" : ""}</Pill>}
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Reached" value={broadcast.recipients} tone="ink" />
              <StatTile label="Bell" value={broadcast.inApp} note="students" />
              <StatTile label="Push" value={broadcast.pushed} note="had a device on" />
              <StatTile label="Email" value={broadcast.emailed} note="queued" />
            </div>

            <h3 className="mt-8 text-lg font-medium tracking-tight">Recipients</h3>
            {recipients === undefined ? (
              <div className="flex justify-center py-10">
                <WritingDots label="Loading recipients" />
              </div>
            ) : recipients.length === 0 ? (
              <div className="mt-3">
                <EmptyNote>Nobody yet.</EmptyNote>
              </div>
            ) : (
              <ul className="mt-3 divide-y divide-line">
                {recipients.map((row) => (
                  <li key={row._id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                    <Avatar name={row.name} email={row.email} size="sm" />
                    <span className="min-w-0 flex-1 basis-40">
                      <span className="block truncate font-medium">{row.name || row.email || "Deleted account"}</span>
                      <span className="block truncate text-xs text-graphite">
                        {row.name !== "" ? row.email || "Deleted account" : row.role === "none" ? "No account you reach" : ""}
                      </span>
                    </span>
                    <Pill>{row.role === "none" ? "Address" : ROLE_LABEL[row.role]}</Pill>
                    <span className="flex flex-wrap gap-1.5">
                      {row.invited && <Mark ok label="Invited" />}
                      <Mark ok={row.inApp} label="Bell" />
                      <Mark ok={row.devices > 0} label={row.devices > 0 ? `Push · ${row.devices}` : "Push"} />
                      <Mark ok={row.emailed} label={row.emailed ? "Email" : `Email · ${EMAIL_SKIP_LABEL[row.emailSkipped ?? "off"]}`} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {recipients !== undefined && recipients.length > 0 && (
              <ListFooter shown={recipients.length} noun="people" status={status} onLoadMore={onLoadMore} />
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

function Mark({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${
        ok ? "bg-ok/12 text-ok" : "bg-panel text-graphite"
      }`}
    >
      {ok ? <Check className="size-3" /> : <Cross className="size-3" />}
      {label}
    </span>
  );
}
