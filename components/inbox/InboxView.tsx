"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Segmented, SelectInput } from "@/components/ui/form";
import { ArrowRight, Mail } from "@/components/ui/icons";
import { Pill, type PillTone } from "@/components/ui/Pill";
import { timeAgo } from "@/lib/format";
import { STAFF_STATUS_LABEL, TOPIC_LABEL, topicText, type ConversationStatus, type InboxItem, type Topic } from "./types";

type Filter = "open" | "answered" | "resolved" | "all";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "open", label: "Needs reply" },
  { value: "answered", label: "Replied" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All" },
];

export const STATUS_TONE: Record<ConversationStatus, PillTone> = {
  open: "lime",
  answered: "panel",
  resolved: "ok",
};

/**
 * Messages students sent from the contact card: to this lecturer, and (for
 * super admins) to the Kalami team. Nobody sees conversations meant for
 * someone else.
 */
export function InboxView({ items, now }: { items: InboxItem[] | undefined; now: number }) {
  const [filter, setFilter] = useState<Filter>("open");
  const [course, setCourse] = useState("");
  const [topic, setTopic] = useState("");

  const courses = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of items ?? []) if (item.courseId && item.courseTitle) seen.set(item.courseId, item.courseTitle);
    return [...seen.entries()];
  }, [items]);
  const topics = useMemo(() => [...new Set((items ?? []).map((item) => item.topic))], [items]);
  const counts = useMemo(() => {
    const out = { open: 0, answered: 0, resolved: 0, all: items?.length ?? 0 };
    for (const item of items ?? []) out[item.status]++;
    return out;
  }, [items]);

  const shown = (items ?? []).filter(
    (item) =>
      (filter === "all" || item.status === filter) &&
      (course === "" || item.courseId === course) &&
      (topic === "" || item.topic === topic),
  );
  const hasTeam = (items ?? []).some((item) => item.as === "admin");

  return (
    <div className="rounded-[2.75rem] bg-panel px-4 pb-4 pt-10 sm:px-10 sm:pb-8 sm:pt-14 lg:px-12">
      <div className="px-1">
        <p className="-rotate-2 font-hand text-[1.8rem] leading-none text-graphite">Students wrote</p>
        <h1 className="mt-3 text-5xl font-medium leading-[0.95] tracking-[-0.045em] sm:text-7xl">Inbox</h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-graphite">
          Messages from the contact card in the student app, with the course and week they were writing from. You get
          an email for each new one; replies happen here.
          {hasTeam && " Messages marked Team went to the whole Kalami team; any super admin can answer them."}
        </p>
      </div>

      <div className="mt-8 flex flex-wrap items-end gap-3 px-1">
        <div className="max-w-full overflow-x-auto">
          <Segmented
            label="Show"
            value={filter}
            options={FILTERS.map((f) => ({ value: f.value, label: `${f.label} ${counts[f.value]}` }))}
            onChange={setFilter}
          />
        </div>
        {courses.length > 1 && (
          <SelectInput aria-label="Course" value={course} onChange={(e) => setCourse(e.target.value)} className="w-auto">
            <option value="">All courses</option>
            {courses.map(([id, title]) => (
              <option key={id} value={id}>
                {title}
              </option>
            ))}
          </SelectInput>
        )}
        {topics.length > 1 && (
          <SelectInput aria-label="Topic" value={topic} onChange={(e) => setTopic(e.target.value)} className="w-auto">
            <option value="">All topics</option>
            {topics.map((id) => (
              <option key={id} value={id}>
                {TOPIC_LABEL[id as Topic]}
              </option>
            ))}
          </SelectInput>
        )}
      </div>

      <div className="mt-5">
        {items === undefined ? (
          <div className="rounded-[2rem] bg-card p-8 text-graphite">Loading messages…</div>
        ) : shown.length === 0 ? (
          <div className="rounded-[2rem] bg-card px-6 py-12 text-center">
            <span className="mx-auto grid size-12 place-items-center rounded-full bg-panel">
              <Mail className="size-5" />
            </span>
            <p className="mt-4 font-medium">
              {items.length === 0 ? "No messages yet" : filter === "open" ? "Nothing waiting for you" : "Nothing here"}
            </p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-graphite">
              {items.length === 0
                ? "When a student writes from the contact card in the student app, it lands here and in your email."
                : "Try another filter."}
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {shown.map((item) => (
              <li key={item._id}>
                <InboxRow item={item} now={now} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function InboxRow({ item, now }: { item: InboxItem; now: number }) {
  return (
    <Link
      href={`/inbox/${item._id}`}
      className="flex items-center gap-3 rounded-[1.5rem] bg-card px-4 py-4 transition hover:ring-1 hover:ring-ink/15 sm:gap-4 sm:px-5"
    >
      <span className="relative grid size-10 shrink-0 place-items-center rounded-full bg-panel text-sm font-semibold">
        {initials(item.studentName)}
        {item.unread && (
          <span className="absolute -right-0.5 -top-0.5 size-3 rounded-full border-2 border-card bg-red-pen" aria-label="Unread" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={`truncate ${item.unread ? "font-semibold" : "font-medium"}`}>{item.subject}</span>
          <Pill tone={STATUS_TONE[item.status]}>{STAFF_STATUS_LABEL[item.status]}</Pill>
          {item.as === "admin" && <Pill tone="ink">Team</Pill>}
        </span>
        <span className="mt-1 block truncate text-xs text-graphite">
          {[item.studentName, item.courseTitle, topicText(item)].filter(Boolean).join(" · ")}
        </span>
      </span>
      <span className="hidden shrink-0 text-xs text-graphite sm:block">{timeAgo(item.lastMessageAt, now)}</span>
      <ArrowRight className="size-5 shrink-0 text-graphite" />
    </Link>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}
