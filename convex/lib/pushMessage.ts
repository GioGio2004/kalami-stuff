import type { AssessmentKind, Locale, NotificationKind } from "./validators";

/**
 * What a push notification says: the same event as the bell row and the
 * email, in the student's language, short enough for a lock screen. Kept free
 * of Convex so it can be tested on its own. The service worker (student app,
 * public/sw.js) shows `title`/`body` and opens `url` on tap; `tag` makes a
 * resent push replace the earlier one instead of stacking.
 */
export type PushMessage = {
  title: string;
  body: string;
  url: string;
  tag: string;
  lang: Locale;
};

const KIND = {
  ka: { task: "დავალება", quiz: "ქვიზი", midterm: "შუალედური გამოცდა", final: "ფინალური გამოცდა" },
  en: { task: "task", quiz: "quiz", midterm: "midterm", final: "final exam" },
} satisfies Record<Locale, Record<AssessmentKind, string>>;

const TITLE = {
  ka: {
    published: (kind: string) => `ახალი ${kind}`,
    due_24h: () => "ხვალ იწურება",
    due_1h: () => "1 საათი დარჩა",
  },
  en: {
    published: (kind: string) => `New ${kind}`,
    due_24h: () => "Due tomorrow",
    due_1h: () => "Due in one hour",
  },
} satisfies Record<Locale, Record<NotificationKind, (kind: string) => string>>;

function dueLine(locale: Locale, dueAt: number): string {
  const when = new Intl.DateTimeFormat(locale === "ka" ? "ka-GE" : "en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tbilisi",
  }).format(dueAt);
  return locale === "ka" ? `ბოლო ვადა: ${when}` : `Due ${when}`;
}

export function notificationPushMessage(input: {
  notificationId: string;
  locale: Locale;
  kind: NotificationKind;
  assessmentKind: AssessmentKind;
  title: string;
  courseTitle: string;
  dueAt?: number;
  href: string;
  studentAppUrl: string;
}): PushMessage {
  const kind = KIND[input.locale][input.assessmentKind];
  const title = `${TITLE[input.locale][input.kind](kind)}: ${input.title}`;
  const body = input.dueAt === undefined ? input.courseTitle : `${input.courseTitle} · ${dueLine(input.locale, input.dueAt)}`;
  return {
    title,
    body,
    url: `${input.studentAppUrl.replace(/\/+$/, "")}${input.href}`,
    tag: `notification:${input.notificationId}`,
    lang: input.locale,
  };
}

/** The "send me a test" push: proves the device, nothing else. */
export function testPushMessage(locale: Locale, studentAppUrl: string): PushMessage {
  return {
    title: locale === "ka" ? "Kalami: შეტყობინებები მუშაობს" : "Kalami: notifications work",
    body:
      locale === "ka"
        ? "ასე გაიგებ ახალი დავალებებისა და ვადების შესახებ."
        : "This is how you'll hear about new work and deadlines.",
    url: `${studentAppUrl.replace(/\/+$/, "")}/dashboard`,
    tag: "test",
    lang: locale,
  };
}
