import type { AssessmentKind, Locale, NotificationKind } from "../validators";
import { formatTbilisi } from "./time";

/**
 * Every email Kalami sends, built on one layout (renderEmail): the Kalami
 * header, a white card with a small label, a headline, a few short paragraphs,
 * the key facts as label/value rows, one button with the link written out
 * under it, then a quiet footer. Emails to someone whose language we don't know
 * (invites) carry a Georgian section, then an English one, rather than mixing
 * the two line by line. Every dynamic string is escaped, and the plain-text
 * part says the same as the HTML.
 */

export type RenderedEmail = { subject: string; html: string; text: string };

// --- The layout --------------------------------------------------------------------------

/** One language's part of an email. All strings are plain text; the layout escapes them. */
export type EmailSection = {
  lang: Locale;
  /** A small label above the headline: "Invitation", "New quiz". */
  eyebrow?: string;
  heading: string;
  paragraphs: string[];
  /** Key facts, shown as label/value rows. */
  details?: [label: string, value: string][];
  /** A message quoted as written (a student's message to a lecturer). */
  quote?: string[];
  button?: { label: string; url: string };
  /** Small print right under the button. */
  note?: string;
};

export type EmailFooterLine = { text: string; link?: { label: string; url: string } };

const INK = "#141414";
const BODY = "#3b3a36";
const MUTED = "#6b6a64";
const LINE = "#e6e5df";
const PANEL = "#f0efe9";
const SOFT = "#fafaf7";
const LIME = "#dcf35a";
const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Noto Sans Georgian','BPG Arial',Helvetica,Arial,sans-serif";

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sectionHtml(section: EmailSection): string {
  const parts: string[] = [];
  if (section.eyebrow) {
    parts.push(
      `<p style="margin:0 0 10px;font-size:12px;line-height:1.4;font-weight:600;letter-spacing:0.08em;${section.lang === "en" ? "text-transform:uppercase;" : ""}color:${MUTED};">${escapeHtml(section.eyebrow)}</p>`,
    );
  }
  parts.push(
    `<h1 class="k-h1" style="margin:0 0 16px;overflow-wrap:anywhere;word-break:break-word;font-size:24px;line-height:1.3;font-weight:600;letter-spacing:-0.01em;color:${INK};">${escapeHtml(section.heading)}</h1>`,
  );
  for (const paragraph of section.paragraphs) {
    parts.push(`<p style="margin:0 0 14px;overflow-wrap:anywhere;word-break:break-word;font-size:16px;line-height:1.6;color:${BODY};">${escapeHtml(paragraph)}</p>`);
  }
  if (section.quote && section.quote.length > 0) {
    const lines = section.quote.map((line) => (line === "" ? "&nbsp;" : escapeHtml(line))).join("<br>");
    parts.push(
      `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:6px 0 18px;"><tr><td style="background:${SOFT};border-left:3px solid ${LIME};border-radius:0 12px 12px 0;padding:14px 18px;font-size:15px;line-height:1.6;color:${INK};">${lines}</td></tr></table>`,
    );
  }
  if (section.details && section.details.length > 0) {
    const rows = section.details
      .map(
        ([label, value], index) =>
          `<tr><td style="padding:${index === 0 ? "14px" : "8px"} 18px ${index === section.details!.length - 1 ? "14px" : "0"};width:38%;vertical-align:top;font-size:13px;line-height:1.5;color:${MUTED};">${escapeHtml(label)}</td><td style="padding:${index === 0 ? "14px" : "8px"} 18px ${index === section.details!.length - 1 ? "14px" : "0"} 0;vertical-align:top;overflow-wrap:anywhere;word-break:break-word;font-size:14px;line-height:1.5;font-weight:600;color:${INK};">${escapeHtml(value)}</td></tr>`,
      )
      .join("");
    parts.push(
      `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:6px 0 22px;background:${SOFT};border:1px solid ${LINE};border-radius:12px;">${rows}</table>`,
    );
  }
  if (section.button) {
    parts.push(
      `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:8px 0 4px;"><tr><td style="background:${INK};border-radius:999px;"><a href="${escapeHtml(section.button.url)}" style="display:inline-block;padding:14px 28px;font-size:15px;line-height:1.2;font-weight:600;color:${LIME};text-decoration:none;border-radius:999px;">${escapeHtml(section.button.label)}</a></td></tr></table>`,
    );
  }
  if (section.note) {
    parts.push(`<p style="margin:14px 0 0;font-size:13px;line-height:1.55;color:${MUTED};">${escapeHtml(section.note)}</p>`);
  }
  return `<div lang="${escapeHtml(section.lang)}">${parts.join("\n")}</div>`;
}

function footerHtml(lines: EmailFooterLine[]): string {
  return lines
    .map((line) => {
      const link = line.link
        ? ` <a href="${escapeHtml(line.link.url)}" style="color:${MUTED};text-decoration:underline;">${escapeHtml(line.link.label)}</a>`
        : "";
      return `<p style="margin:0 0 6px;">${escapeHtml(line.text)}${link}</p>`;
    })
    .join("\n");
}

/** The shared layout; returns the email ready to send. */
export function renderEmail(input: {
  /** The main language, for the document. */
  lang: Locale;
  subject: string;
  /** The inbox preview line. */
  preheader: string;
  sections: EmailSection[];
  /** The link written out under the content, for when the button doesn't work. */
  fallback?: { label: string; url: string };
  footer: EmailFooterLine[];
}): RenderedEmail {
  const sections = input.sections
    .map(sectionHtml)
    .join(`\n<div style="height:1px;line-height:1px;font-size:1px;background:${LINE};margin:30px 0;">&nbsp;</div>\n`);
  const fallback = input.fallback
    ? `<div style="margin:28px 0 0;padding:16px 0 0;border-top:1px solid ${LINE};">
<p style="margin:0 0 6px;font-size:12px;line-height:1.5;color:${MUTED};">${escapeHtml(input.fallback.label)}</p>
<p style="margin:0;font-size:12px;line-height:1.5;word-break:break-all;"><a href="${escapeHtml(input.fallback.url)}" style="color:${INK};text-decoration:underline;">${escapeHtml(input.fallback.url)}</a></p>
</div>`
    : "";
  const html = `<!DOCTYPE html>
<html lang="${escapeHtml(input.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<style>
@media (max-width:480px){.k-outer{padding:20px 6px 28px !important}.k-card{padding:26px 20px 24px !important}.k-h1{font-size:21px !important}}
</style>
<title>${escapeHtml(input.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${PANEL};font-family:${FONT};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${PANEL};">${escapeHtml(input.preheader)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${PANEL};">
<tr><td class="k-outer" align="center" style="padding:32px 12px 40px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;">
<tr><td style="padding:0 8px 18px;">
<table role="presentation" cellspacing="0" cellpadding="0"><tr>
<td style="width:34px;height:34px;background:${INK};border-radius:10px;text-align:center;vertical-align:middle;">
<span style="display:inline-block;width:11px;height:16px;margin-top:2px;background:${LIME};border-radius:2px 2px 7px 7px;"></span>
</td>
<td style="padding-left:12px;font-family:${FONT};font-size:19px;font-weight:600;letter-spacing:-0.02em;color:${INK};">Kalami</td>
</tr></table>
</td></tr>
<tr><td style="background:#ffffff;border:1px solid ${LINE};border-radius:20px;overflow:hidden;">
<div style="height:4px;line-height:4px;font-size:4px;background:${LIME};">&nbsp;</div>
<div class="k-card" style="padding:34px 32px 32px;font-family:${FONT};">
${sections}
${fallback}
</div>
</td></tr>
<tr><td style="padding:22px 14px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${MUTED};text-align:center;">
${footerHtml(input.footer)}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    ...input.sections.map((section) =>
      [
        // Georgian has no lowercase/uppercase pair worth using here (it would turn into Mtavruli).
        section.eyebrow ? (section.lang === "en" ? section.eyebrow.toUpperCase() : section.eyebrow) : undefined,
        section.heading,
        "",
        ...section.paragraphs.flatMap((p) => [p, ""]),
        ...(section.quote && section.quote.length > 0 ? [...section.quote.map((line) => `> ${line}`), ""] : []),
        ...(section.details && section.details.length > 0
          ? [...section.details.map(([label, value]) => `${label}: ${value}`), ""]
          : []),
        section.button ? `${section.button.label}: ${section.button.url}` : undefined,
        section.note ? `\n${section.note}` : undefined,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n")
        .trim(),
    ),
  ].join("\n\n----------\n\n");
  const footerText = input.footer
    .map((line) => (line.link ? `${line.text} ${line.link.label}: ${line.link.url}` : line.text))
    .join("\n");
  return {
    subject: input.subject,
    html,
    text: `${text}\n\n--\n${footerText}\n`,
  };
}

const BRAND = {
  ka: "კალამი · შენი საქმე, შენი ხელით · kalami.space",
  en: "Kalami · Your own work, written by your own hand · kalami.space",
};

// --- Assessment notifications (students) ----------------------------------------------------

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

const KIND = {
  ka: { task: "დავალება", quiz: "ქვიზი", midterm: "შუალედური გამოცდა", final: "ფინალური გამოცდა" },
  en: { task: "task", quiz: "quiz", midterm: "midterm", final: "final exam" },
} satisfies Record<Locale, Record<AssessmentKind, string>>;

const COPY = {
  ka: {
    hello: (name: string | undefined) => (name ? `გამარჯობა, ${name}!` : "გამარჯობა!"),
    eyebrow: {
      published: (kind: string) => `ახალი ${kind}`,
      due_24h: () => "შეხსენება",
      due_1h: () => "1 საათი დარჩა",
    },
    published: (kind: string, title: string, course: string) =>
      `კურსში „${course}“ გამოქვეყნდა ახალი ${kind}: „${title}“.`,
    due_24h: (title: string, course: string) => `შეგახსენებთ: „${title}“ (${course}) ხვალ იწურება.`,
    due_1h: (title: string, course: string) => `„${title}“ (${course}) ერთ საათში იწურება.`,
    course: "კურსი",
    type: "ტიპი",
    deadline: "ბოლო ვადა",
    tbilisi: (when: string) => `${when} (თბილისის დროით)`,
    alreadyDone: "თუ უკვე ჩააბარე, ამ წერილს ყურადღება არ მიაქციო.",
    button: "გახსნა კალამში",
    fallback: "ღილაკი არ მუშაობს? გახსენი ეს ბმული ბრაუზერში:",
    subjects: {
      published: (kind: string, title: string) => `ახალი ${kind}: ${title}`,
      due_24h: (title: string) => `ხვალ იწურება: ${title}`,
      due_1h: (title: string) => `1 საათი დარჩა: ${title}`,
    },
    why: (course: string) => `ამ წერილს იღებ, რადგან კალამში კურსის „${course}“ სტუდენტი ხარ.`,
    unsubscribe: "შეტყობინებების გამორთვა",
  },
  en: {
    hello: (name: string | undefined) => (name ? `Hi ${name},` : "Hi,"),
    eyebrow: {
      published: (kind: string) => `New ${kind}`,
      due_24h: () => "Reminder",
      due_1h: () => "Due in one hour",
    },
    published: (kind: string, title: string, course: string) => `A new ${kind} was published in “${course}”: “${title}”.`,
    due_24h: (title: string, course: string) => `Reminder: “${title}” (${course}) is due tomorrow.`,
    due_1h: (title: string, course: string) => `“${title}” (${course}) is due in one hour.`,
    course: "Course",
    type: "Type",
    deadline: "Deadline",
    tbilisi: (when: string) => `${when} (Tbilisi time)`,
    alreadyDone: "If you have already submitted it, you can ignore this.",
    button: "Open in Kalami",
    fallback: "Button not working? Open this link in your browser:",
    subjects: {
      published: (kind: string, title: string) => `New ${kind}: ${title}`,
      due_24h: (title: string) => `Due tomorrow: ${title}`,
      due_1h: (title: string) => `One hour left: ${title}`,
    },
    why: (course: string) => `You get this because you are a student of “${course}” on Kalami.`,
    unsubscribe: "Stop these emails",
  },
} as const;

/** New work or a deadline, for one student, in their language. */
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
  const details: [string, string][] = [
    [copy.course, input.courseTitle],
    [copy.type, kind.charAt(0).toUpperCase() + kind.slice(1)],
  ];
  if (input.dueAt !== undefined) {
    details.push([copy.deadline, copy.tbilisi(formatTbilisi(input.dueAt, input.locale))]);
  }
  return renderEmail({
    lang: input.locale,
    subject,
    preheader: lead,
    sections: [
      {
        lang: input.locale,
        eyebrow: copy.eyebrow[input.kind](kind),
        heading: input.title,
        paragraphs: [copy.hello(input.firstName?.trim() || undefined), lead],
        details,
        button: { label: copy.button, url: input.url },
        note: input.kind === "published" ? undefined : copy.alreadyDone,
      },
    ],
    fallback: { label: copy.fallback, url: input.url },
    footer: [
      { text: copy.why(input.courseTitle), link: { label: copy.unsubscribe, url: input.unsubscribeUrl } },
      { text: BRAND[input.locale] },
    ],
  });
}

// --- Invitations (language unknown: Georgian, then English) ------------------------------------

const INVITE_FALLBACK = "ღილაკი არ მუშაობს? დააკოპირე ეს ბმული ბრაუზერში. · Button not working? Paste this link into your browser:";
const INVITE_IGNORE = {
  ka: "თუ ამ მოწვევას არ ელოდი, უბრალოდ წაშალე ეს წერილი.",
  en: "If you weren't expecting this invitation, you can ignore this email.",
};

export type GroupInviteEmailInput = {
  /** The lecturer's name as students know it. */
  inviterName: string;
  groupName: string;
  /** The personal invite link in the student app. */
  url: string;
};

/**
 * Someone invited this address to a group of students. The person may have no
 * account yet and we don't know their language, so it comes in Georgian, then
 * English. No unsubscribe link: it is one email a person was invited with, not
 * a newsletter, and it says how to ignore it.
 */
export function renderGroupInviteEmail(input: GroupInviteEmailInput): RenderedEmail {
  const { inviterName, groupName, url } = input;
  const subject = `${inviterName} გიწვევს ჯგუფში „${groupName}“ · Join ${groupName} on Kalami`;
  const ka: EmailSection = {
    lang: "ka",
    eyebrow: "მოწვევა ჯგუფში",
    heading: `შემოუერთდი ჯგუფს „${groupName}“`,
    paragraphs: [
      `${inviterName} გიწვევს კალამზე, ჯგუფში „${groupName}“. აქ ნახავ ამ ჯგუფის კურსებს, მასალებს, დავალებებსა და ქვიზებს.`,
      "მოწვევის მისაღებად შედი ან დარეგისტრირდი სწორედ ამ ელფოსტით.",
    ],
    details: [
      ["ჯგუფი", groupName],
      ["მოგიწვია", inviterName],
    ],
    button: { label: "მოწვევის მიღება", url },
  };
  const en: EmailSection = {
    lang: "en",
    eyebrow: "Group invitation",
    heading: `Join “${groupName}” on Kalami`,
    paragraphs: [
      `${inviterName} invited you to the group “${groupName}” on Kalami, where you'll find its courses, materials, tasks and quizzes.`,
      "Sign in with this email address to accept.",
    ],
    details: [
      ["Group", groupName],
      ["Invited by", inviterName],
    ],
    button: { label: "Accept invitation", url },
  };
  return renderEmail({
    lang: "ka",
    subject,
    preheader: `${inviterName} invited you to “${groupName}” on Kalami.`,
    sections: [ka, en],
    fallback: { label: INVITE_FALLBACK, url },
    footer: [{ text: `${INVITE_IGNORE.ka} ${INVITE_IGNORE.en}` }, { text: "კალამი · Kalami · kalami.space" }],
  });
}

export type StaffInviteEmailInput = {
  inviterName: string;
  role: "lecturer" | "uni_admin";
  /** Absent for an independent teacher (a school, private lessons). */
  universityName?: { ka: string; en: string };
  /** The address the invite is for: they must sign in with it. */
  email: string;
  /** The personal invite page in the staff app. */
  url: string;
  expiresAt: number;
};

/**
 * An admin invited this address to teach on Kalami (or to run a university on
 * it). Georgian, then English; the link only works for this address.
 */
export function renderStaffInviteEmail(input: StaffInviteEmailInput): RenderedEmail {
  const { inviterName, email, url } = input;
  const lecturer = input.role === "lecturer";
  const subject = lecturer
    ? `მოწვევა კალამში · ${inviterName} invited you to teach on Kalami`
    : `მოწვევა კალამში · ${inviterName} invited you to Kalami as a university admin`;
  const ka: EmailSection = {
    lang: "ka",
    eyebrow: "მოწვევა",
    heading: lecturer ? "მოგიწვიეს კალამში ლექტორად" : "მოგიწვიეს კალამში უნივერსიტეტის ადმინისტრატორად",
    paragraphs: [
      lecturer
        ? `${inviterName} გიწვევს კალამში. აქ ქმნი კურსებს, გაკვეთილებს, ქვიზებსა და გამოცდებს, შენი სტუდენტები კი მათ აქვე გადიან.`
        : `${inviterName} გიწვევს კალამში უნივერსიტეტის ადმინისტრატორად: მოიწვევ ლექტორებს, შექმნი ჯგუფებს და ნახავ უნივერსიტეტის ყველა კურსს.`,
      `ბმული პირადია: შედი ან დარეგისტრირდი სწორედ ამ ელფოსტით (${email}).`,
    ],
    details: [
      ["როლი", lecturer ? "ლექტორი" : "უნივერსიტეტის ადმინისტრატორი"],
      ["უნივერსიტეტი", input.universityName?.ka ?? "დამოუკიდებელი მასწავლებელი"],
      ["მოგიწვია", inviterName],
      ["მოქმედებს", `${formatTbilisi(input.expiresAt, "ka")}-მდე`],
    ],
    button: { label: "მოწვევის მიღება", url },
  };
  const en: EmailSection = {
    lang: "en",
    eyebrow: "Invitation",
    heading: lecturer ? "You're invited to teach on Kalami" : "You're invited to Kalami as a university admin",
    paragraphs: [
      lecturer
        ? `${inviterName} invited you to Kalami, where you build courses, lessons, quizzes and exams, and your students take them.`
        : `${inviterName} invited you to Kalami as a university admin: you'll invite lecturers, make groups and see every course of your university.`,
      `The link is personal: sign in or sign up with this email address (${email}).`,
    ],
    details: [
      ["Role", lecturer ? "Lecturer" : "University admin"],
      ["University", input.universityName?.en ?? "Independent teacher"],
      ["Invited by", inviterName],
      ["Valid until", `${formatTbilisi(input.expiresAt, "en")} (Tbilisi time)`],
    ],
    button: { label: "Accept invitation", url },
  };
  return renderEmail({
    lang: "ka",
    subject,
    preheader: `${inviterName} invited you to Kalami. მოწვევა კალამში.`,
    sections: [ka, en],
    fallback: { label: INVITE_FALLBACK, url },
    footer: [{ text: `${INVITE_IGNORE.ka} ${INVITE_IGNORE.en}` }, { text: "კალამი · Kalami · kalami.space" }],
  });
}

// --- Messages (the contact card) ---------------------------------------------------------------

export type StaffMessageEmailInput = {
  locale: Locale;
  studentName: string;
  subject: string;
  /** What it's about, e.g. "Web basics · Week 3". */
  context?: string;
  body: string;
  /** A reply, rather than the first message of the conversation. */
  isReply: boolean;
  /** The conversation in the staff app. */
  url: string;
};

const MESSAGE_COPY = {
  ka: {
    staffSubject: (name: string, subject: string, reply: boolean) => `${reply ? "პასუხი" : "შეტყობინება"}: ${subject} · ${name}`,
    staffEyebrow: (reply: boolean) => (reply ? "სტუდენტის პასუხი" : "ახალი შეტყობინება"),
    staffLead: (name: string, reply: boolean) => (reply ? `${name} გიპასუხა კალამში:` : `${name} მოგწერა კალამში:`),
    from: "ვისგან",
    about: "თემა",
    staffButton: "პასუხი კალამში",
    staffNote: "ამ წერილზე პასუხი სტუდენტამდე ვერ მივა: უპასუხე კალამში, ღილაკით.",
    studentSubject: (name: string, subject: string) => `${name} გიპასუხა: ${subject}`,
    studentEyebrow: "ახალი პასუხი",
    studentHeading: (name: string) => `${name} გიპასუხა`,
    studentLead: (name: string, subject: string) => `${name} გიპასუხა შენს შეტყობინებაზე „${subject}“.`,
    studentHint: "პასუხის წასაკითხად და დასაწერად გახსენი კალამი.",
    studentButton: "საუბრის გახსნა",
    fallback: "ღილაკი არ მუშაობს? გახსენი ეს ბმული ბრაუზერში:",
    unsubscribe: "წერილების გამორთვა",
    whyStudent: "ამ წერილს იღებ, რადგან კალამში შეტყობინება გაგზავნე.",
  },
  en: {
    staffSubject: (name: string, subject: string, reply: boolean) => `${reply ? "Reply" : "Message"}: ${subject} · ${name}`,
    staffEyebrow: (reply: boolean) => (reply ? "Student reply" : "New message"),
    staffLead: (name: string, reply: boolean) => (reply ? `${name} replied in Kalami:` : `${name} wrote to you in Kalami:`),
    from: "From",
    about: "About",
    staffButton: "Reply in Kalami",
    staffNote: "Replies to this email don't reach the student: answer in Kalami with the button.",
    studentSubject: (name: string, subject: string) => `${name} replied: ${subject}`,
    studentEyebrow: "New reply",
    studentHeading: (name: string) => `${name} replied`,
    studentLead: (name: string, subject: string) => `${name} replied to your message “${subject}”.`,
    studentHint: "Open Kalami to read it and reply.",
    studentButton: "Open the conversation",
    fallback: "Button not working? Open this link in your browser:",
    unsubscribe: "Stop these emails",
    whyStudent: "You get this because you sent a message on Kalami.",
  },
} as const;

const MAX_EMAIL_BODY_LINES = 40;

/**
 * A student wrote to a lecturer or the Kalami team. The message is in the email
 * so staff can triage it, but replies happen in Kalami: the reply-to is not the
 * student, and the email says so.
 */
export function renderStaffMessageEmail(input: StaffMessageEmailInput): RenderedEmail {
  const copy = MESSAGE_COPY[input.locale];
  const subject = copy.staffSubject(input.studentName, input.subject, input.isReply);
  const bodyLines = input.body.trim().split(/\r?\n/).slice(0, MAX_EMAIL_BODY_LINES);
  const details: [string, string][] = [[copy.from, input.studentName]];
  if (input.context) details.push([copy.about, input.context]);
  return renderEmail({
    lang: input.locale,
    subject,
    preheader: bodyLines[0] ?? subject,
    sections: [
      {
        lang: input.locale,
        eyebrow: copy.staffEyebrow(input.isReply),
        heading: input.subject,
        paragraphs: [copy.staffLead(input.studentName, input.isReply)],
        quote: bodyLines,
        details,
        button: { label: copy.staffButton, url: input.url },
        note: copy.staffNote,
      },
    ],
    fallback: { label: copy.fallback, url: input.url },
    footer: [{ text: BRAND[input.locale] }],
  });
}

export type StudentReplyEmailInput = {
  locale: Locale;
  staffName: string;
  subject: string;
  url: string;
  unsubscribeUrl: string;
};

/**
 * Staff replied to a student. Deliberately without the reply itself: answers
 * about grades or absences shouldn't sit in a lock-screen preview. One tap
 * opens the conversation.
 */
export function renderStudentReplyEmail(input: StudentReplyEmailInput): RenderedEmail {
  const copy = MESSAGE_COPY[input.locale];
  const subject = copy.studentSubject(input.staffName, input.subject);
  const lead = copy.studentLead(input.staffName, input.subject);
  return renderEmail({
    lang: input.locale,
    subject,
    preheader: lead,
    sections: [
      {
        lang: input.locale,
        eyebrow: copy.studentEyebrow,
        heading: copy.studentHeading(input.staffName),
        paragraphs: [lead, copy.studentHint],
        button: { label: copy.studentButton, url: input.url },
      },
    ],
    fallback: { label: copy.fallback, url: input.url },
    footer: [
      { text: copy.whyStudent, link: { label: copy.unsubscribe, url: input.unsubscribeUrl } },
      { text: BRAND[input.locale] },
    ],
  });
}

// --- The unsubscribe page ----------------------------------------------------------------------

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
body{margin:0;background:${PANEL};font-family:${FONT};color:${INK}}
main{max-width:520px;margin:48px auto;padding:32px 28px;background:#fff;border:1px solid ${LINE};border-radius:20px;border-top:4px solid ${LIME}}
h1{font-size:22px;line-height:1.3;margin:0 0 12px}h1 span,p span{color:${MUTED};font-weight:400}
p{font-size:15px;line-height:1.6;margin:0 0 20px}
button{background:${INK};color:${LIME};border:0;border-radius:999px;padding:13px 24px;font-size:15px;font-weight:600;cursor:pointer}
</style>
</head>
<body><main>${body}</main></body>
</html>`;
}
