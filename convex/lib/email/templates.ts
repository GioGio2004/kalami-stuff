import type { AssessmentKind, Locale, NotificationKind } from "../validators";
import { formatTbilisi } from "./time";

/**
 * The notification emails, in the student's language. Plain and short: what
 * happened, when it's due, one button, and how to switch these off. Every
 * dynamic string is escaped; the text part says the same as the HTML.
 */

export type NotificationEmailInput = {
  locale: Locale;
  firstName?: string;
  kind: NotificationKind;
  assessmentKind: AssessmentKind;
  title: string;
  courseTitle: string;
  dueAt?: number;
  /** Where the button goes: the work in the student app. */
  url: string;
  /** One click stops these emails for this person. */
  unsubscribeUrl: string;
};

export type RenderedEmail = { subject: string; html: string; text: string };

const KIND = {
  ka: { task: "დავალება", quiz: "ქვიზი", midterm: "შუალედური გამოცდა", final: "ფინალური გამოცდა" },
  en: { task: "task", quiz: "quiz", midterm: "midterm", final: "final exam" },
} satisfies Record<Locale, Record<AssessmentKind, string>>;

const COPY = {
  ka: {
    hello: (name: string | undefined) => (name ? `გამარჯობა, ${name}!` : "გამარჯობა!"),
    published: (kind: string, title: string, course: string) =>
      `კურსში „${course}“ გამოქვეყნდა ახალი ${kind}: „${title}“.`,
    due_24h: (title: string, course: string) => `შეგახსენებთ: „${title}“ (${course}) ხვალ იწურება.`,
    due_1h: (title: string, course: string) => `„${title}“ (${course}) ერთ საათში იწურება.`,
    deadline: (when: string) => `ბოლო ვადა: ${when} (თბილისის დროით).`,
    alreadyDone: "თუ უკვე ჩააბარე, ამ წერილს ყურადღება არ მიაქციო.",
    button: "გახსნა კალამში",
    subjects: {
      published: (kind: string, title: string) => `ახალი ${kind}: ${title}`,
      due_24h: (title: string) => `ხვალ იწურება: ${title}`,
      due_1h: (title: string) => `1 საათი დარჩა: ${title}`,
    },
    why: (course: string) => `ამ წერილს იღებ, რადგან კალამში კურსის „${course}“ სტუდენტი ხარ.`,
    unsubscribe: "შეტყობინებების გამორთვა",
    footer: "კალამი · შენი საქმე, შენი ხელით.",
  },
  en: {
    hello: (name: string | undefined) => (name ? `Hi ${name},` : "Hi,"),
    published: (kind: string, title: string, course: string) => `A new ${kind} was published in “${course}”: “${title}”.`,
    due_24h: (title: string, course: string) => `Reminder: “${title}” (${course}) is due tomorrow.`,
    due_1h: (title: string, course: string) => `“${title}” (${course}) is due in one hour.`,
    deadline: (when: string) => `Deadline: ${when} (Tbilisi time).`,
    alreadyDone: "If you have already submitted it, you can ignore this.",
    button: "Open in Kalami",
    subjects: {
      published: (kind: string, title: string) => `New ${kind}: ${title}`,
      due_24h: (title: string) => `Due tomorrow: ${title}`,
      due_1h: (title: string) => `One hour left: ${title}`,
    },
    why: (course: string) => `You get this because you are a student of “${course}” on Kalami.`,
    unsubscribe: "Stop these emails",
    footer: "Kalami · Your own work, written by your own hand.",
  },
} as const;

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderNotificationEmail(input: NotificationEmailInput): RenderedEmail {
  const copy = COPY[input.locale];
  const kind = KIND[input.locale][input.assessmentKind];
  const subject =
    input.kind === "published"
      ? copy.subjects.published(kind, input.title)
      : input.kind === "due_24h"
        ? copy.subjects.due_24h(input.title)
        : copy.subjects.due_1h(input.title);
  const lead =
    input.kind === "published"
      ? copy.published(kind, input.title, input.courseTitle)
      : input.kind === "due_24h"
        ? copy.due_24h(input.title, input.courseTitle)
        : copy.due_1h(input.title, input.courseTitle);
  const lines = [
    copy.hello(input.firstName?.trim() || undefined),
    lead,
    input.dueAt !== undefined ? copy.deadline(formatTbilisi(input.dueAt, input.locale)) : undefined,
    input.kind === "published" ? undefined : copy.alreadyDone,
  ].filter((line): line is string => line !== undefined);

  const text = [
    ...lines,
    "",
    `${copy.button}: ${input.url}`,
    "",
    copy.why(input.courseTitle),
    `${copy.unsubscribe}: ${input.unsubscribeUrl}`,
    "",
    copy.footer,
  ].join("\n");

  const html = emailShell({
    lang: input.locale,
    subject,
    preheader: lead,
    lines,
    button: { label: copy.button, url: input.url },
    footerHtml: `<p style="margin:0 0 6px;">${escapeHtml(copy.why(input.courseTitle))}
<a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#64635e;text-decoration:underline;">${escapeHtml(copy.unsubscribe)}</a></p>
<p style="margin:0;">${escapeHtml(copy.footer)} · <a href="https://kalami.space" style="color:#64635e;">kalami.space</a></p>`,
  });

  return { subject, html, text };
}

/** The frame every Kalami email shares: logo, a white card with the lines and one button, then the footer. */
function emailShell(input: {
  lang: string;
  subject: string;
  preheader: string;
  /** Plain text, escaped here; an empty string makes a small gap. */
  lines: string[];
  button: { label: string; url: string };
  /** Already escaped. */
  footerHtml: string;
}): string {
  const paragraphs = input.lines
    .map((line) =>
      line === ""
        ? `<div style="height:10px;line-height:10px;">&nbsp;</div>`
        : `<p style="margin:0 0 14px;font-size:16px;line-height:1.55;color:#141414;">${escapeHtml(line)}</p>`,
    )
    .join("");
  return `<!DOCTYPE html>
<html lang="${escapeHtml(input.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(input.subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f0efe9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Noto Sans Georgian','Helvetica Neue',Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(input.preheader)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f0efe9;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;">
<tr><td style="padding:0 8px 16px;">
<table role="presentation" cellspacing="0" cellpadding="0"><tr>
<td style="width:28px;height:28px;background:#141414;border-radius:8px;text-align:center;vertical-align:middle;">
<span style="display:inline-block;width:10px;height:14px;background:#dcf35a;border-radius:2px 2px 6px 6px;"></span>
</td>
<td style="padding-left:10px;font-size:18px;font-weight:600;color:#141414;letter-spacing:-0.02em;">Kalami</td>
</tr></table>
</td></tr>
<tr><td style="background:#ffffff;border-radius:24px;padding:32px 28px;">
${paragraphs}
<table role="presentation" cellspacing="0" cellpadding="0" style="margin:22px 0 6px;"><tr>
<td style="background:#141414;border-radius:999px;">
<a href="${escapeHtml(input.button.url)}" style="display:inline-block;padding:13px 24px;font-size:15px;font-weight:600;color:#dcf35a;text-decoration:none;border-radius:999px;">${escapeHtml(input.button.label)}</a>
</td></tr></table>
</td></tr>
<tr><td style="padding:20px 12px 0;font-size:12px;line-height:1.6;color:#64635e;">
${input.footerHtml}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

export type GroupInviteEmailInput = {
  /** The lecturer's name as students know it. */
  inviterName: string;
  groupName: string;
  /** The personal invite link in the student app. */
  url: string;
};

/**
 * A lecturer invited this address to a group. The person may have no account
 * yet and we don't know their language, so the email says everything in
 * Georgian, then English. No unsubscribe link: it is one email a person asked
 * a lecturer for, not a newsletter, and it says how to ignore it.
 */
export function renderGroupInviteEmail(input: GroupInviteEmailInput): RenderedEmail {
  const subject = `${input.inviterName} გიწვევს ჯგუფში „${input.groupName}“ · Join ${input.groupName} on Kalami`;
  const lines = [
    `${input.inviterName} გიწვევს კალამზე ჯგუფში „${input.groupName}“. აქ ნახავ ამ ჯგუფის კურსებს, მასალებს, დავალებებსა და ქვიზებს.`,
    "შესვლა შეგიძლია ნებისმიერი ანგარიშით, მაგრამ მოწვევის მისაღებად გამოიყენე სწორედ ეს ელფოსტა.",
    "",
    `${input.inviterName} invited you to the group “${input.groupName}” on Kalami, where you'll find its courses, materials, tasks and quizzes.`,
    "Sign in with this email address to accept.",
  ];
  const button = "მიღება · Accept invite";
  const ignore = "თუ არ იცნობ ამ მასწავლებელს, უბრალოდ წაშალე ეს წერილი. · If you don't know this teacher, just ignore this email.";
  const footer = "კალამი · შენი საქმე, შენი ხელით. · Kalami";
  const text = [...lines, "", `${button}: ${input.url}`, "", ignore, "", footer].join("\n");
  const html = emailShell({
    lang: "ka",
    subject,
    preheader: lines[0],
    lines,
    button: { label: button, url: input.url },
    footerHtml: `<p style="margin:0 0 6px;">${escapeHtml(ignore)}</p>
<p style="margin:0;">${escapeHtml(footer)} · <a href="https://kalami.space" style="color:#64635e;">kalami.space</a></p>`,
  });
  return { subject, html, text };
}

/** The unsubscribe page served by the backend (GET: a question, POST: done), both languages at once. */
export function renderUnsubscribePage(state: "ask" | "done" | "invalid"): string {
  const body =
    state === "ask"
      ? `<h1>კალამის წერილების გამორთვა?<br><span>Stop Kalami notification emails?</span></h1>
<p>ახალი დავალებებისა და ვადების შესახებ წერილები აღარ მოგივა. აპლიკაციაში ზარის ქვეშ ისევ ჩართავ.<br>
<span>You will no longer get emails about new work and deadlines. You can switch them back on under the bell in the app.</span></p>
<form method="post"><button type="submit">გამორთვა · Unsubscribe</button></form>`
      : state === "done"
        ? `<h1>გამორთულია.<br><span>Done.</span></h1>
<p>კალამი აღარ გამოგიგზავნის შეტყობინებებს ელფოსტით.<br><span>Kalami will not email you notifications any more.</span></p>`
        : `<h1>ბმული არასწორია.<br><span>This link is not valid.</span></h1>
<p>გახსენი კალამი და გამორთე წერილები ზარის ქვეშ.<br><span>Open Kalami and switch emails off under the bell.</span></p>`;
  return `<!DOCTYPE html>
<html lang="ka">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Kalami</title>
<style>
body{margin:0;background:#f0efe9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Noto Sans Georgian',Arial,sans-serif;color:#141414}
main{max-width:520px;margin:48px auto;padding:32px 28px;background:#fff;border-radius:24px}
h1{font-size:22px;line-height:1.3;margin:0 0 12px}h1 span,p span{color:#64635e;font-weight:400}
p{font-size:15px;line-height:1.6;margin:0 0 20px}
button{background:#141414;color:#dcf35a;border:0;border-radius:999px;padding:13px 24px;font-size:15px;font-weight:600;cursor:pointer}
</style>
</head>
<body><main>${body}</main></body>
</html>`;
}
