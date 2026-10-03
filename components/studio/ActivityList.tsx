import { Pen, Robot } from "@/components/ui/icons";
import { timeAgo } from "@/lib/format";
import type { AuditEntry } from "./types";

/** Who did what, newest first. Agent actions get the robot. */
export function ActivityList({
  entries,
  emptyText = "Nothing yet. Your first course will show up here.",
  dark = false,
}: {
  entries: AuditEntry[] | undefined;
  emptyText?: string;
  dark?: boolean;
}) {
  if (entries === undefined) {
    return <p className={`text-sm ${dark ? "text-paper/55" : "text-graphite"}`}>Loading…</p>;
  }
  if (entries.length === 0) {
    return <p className={`text-sm ${dark ? "text-paper/55" : "text-graphite"}`}>{emptyText}</p>;
  }
  const muted = dark ? "text-paper/55" : "text-graphite";
  return (
    <div>
    <ul className="space-y-2">
      {entries.map((entry) => {
        const agent = entry.via === "mcp";
        const who = entry.mine ? (agent ? "your agent" : "you") : `${entry.actorName}${agent ? "’s agent" : ""}`;
        return (
          <li
            key={entry._id}
            className={`flex items-center gap-3 rounded-2xl px-4 py-2.5 text-sm ${dark ? "bg-charcoal-soft" : "bg-paper"}`}
          >
            <span
              className={`grid size-7 shrink-0 place-items-center rounded-full ${
                agent ? "bg-highlighter text-ink" : dark ? "bg-paper/15 text-paper" : "bg-panel text-ink"
              }`}
              title={agent ? "Done by an AI agent" : "Done in the dashboard"}
            >
              {agent ? <Robot className="size-4" /> : <Pen className="size-4" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{entry.summary}</span>
              <span className={`block text-xs ${dark ? "text-paper/55" : "text-graphite"}`}>
                by {who} · {timeAgo(entry.at)}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
    <p className={`mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs ${muted}`}>
      <span className="inline-flex items-center gap-1.5">
        <Pen className="size-3.5" /> made in the dashboard
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Robot className="size-3.5" /> made by an AI agent
      </span>
    </p>
    </div>
  );
}
