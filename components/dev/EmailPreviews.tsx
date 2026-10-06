"use client";

import { useState } from "react";
import {
  renderAnnouncementEmail,
  renderGroupInviteEmail,
  renderNotificationEmail,
  renderStaffInviteEmail,
  renderStaffMessageEmail,
  renderStudentReplyEmail,
  type RenderedEmail,
} from "@/convex/lib/email/templates";

// Development-only: every email Kalami sends, rendered by the real templates
// with sample data, at a desktop and a phone width. Part of the screen gallery.

const DUE = Date.UTC(2026, 9, 19, 14, 0);
const UNSUBSCRIBE = "https://example.convex.site/email/unsubscribe?u=1&t=2";

const EMAILS: { name: string; email: RenderedEmail }[] = [
  {
    name: "Staff invitation · lecturer at a university",
    email: renderStaffInviteEmail({
      inviterName: "Giorgi Khvichia",
      role: "lecturer",
      universityName: { ka: "საქართველოს ტექნიკური უნივერსიტეტი", en: "Georgian Technical University" },
      email: "nino.beridze@gtu.ge",
      url: "https://staff.kalami.space/invite/6f1c2a9e4b7d40c1a8e3f5d2b9c07e41a6d3f8b2c5e1d9a4",
      expiresAt: DUE,
    }),
  },
  {
    name: "Staff invitation · university admin",
    email: renderStaffInviteEmail({
      inviterName: "Giorgi Khvichia",
      role: "uni_admin",
      universityName: { ka: "გორის სახელმწიფო უნივერსიტეტი", en: "Gori State University" },
      email: "dean@gsu.edu.ge",
      url: "https://staff.kalami.space/invite/a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718",
      expiresAt: DUE,
    }),
  },
  {
    name: "Staff invitation · independent teacher",
    email: renderStaffInviteEmail({
      inviterName: "Giorgi Khvichia",
      role: "lecturer",
      email: "tutor@gmail.com",
      url: "https://staff.kalami.space/invite/0f9e8d7c6b5a49382716f5e4d3c2b1a00f9e8d7c6b5a4938",
      expiresAt: DUE,
    }),
  },
  {
    name: "Announcement from the notification center · student, Georgian, with a link",
    email: renderAnnouncementEmail({
      locale: "ka",
      firstName: "ანა",
      from: "გორის სახელმწიფო უნივერსიტეტი",
      title: "ბიბლიოთეკა პარასკევს დაკეტილია",
      body: "მთავარი ბიბლიოთეკა ამ პარასკევს ტექნიკური სამუშაოების გამო დაკეტილია.\n\nმეორე სართულის სამკითხველო დარბაზები 18:00-მდე ღიაა.",
      url: "https://app.kalami.space/dashboard",
      unsubscribeUrl: UNSUBSCRIBE,
    }),
  },
  {
    name: "Announcement from the notification center · lecturer, English, no link",
    email: renderAnnouncementEmail({
      locale: "en",
      firstName: "Nino",
      from: "Kalami",
      title: "Kalami is getting push notifications",
      body: "From this week students can turn on notifications in the app and hear about new work and deadlines on their phones.\n\nNothing changes for you: the studio works as before.",
      unsubscribeUrl: UNSUBSCRIBE,
    }),
  },
  {
    name: "Group invitation (students)",
    email: renderGroupInviteEmail({
      inviterName: "Tea Todua",
      groupName: "ICT-24-1",
      url: "https://app.kalami.space/join/invite/q3Xk9mPz2LtV8wRbN4c7",
    }),
  },
  {
    name: "New quiz · Georgian",
    email: renderNotificationEmail({
      locale: "ka",
      firstName: "ანა",
      kind: "published",
      assessmentKind: "quiz",
      title: "ქვიზი 3 · ფონები, ტექსტი, შრიფტები და ფერები",
      courseTitle: "ვებ ტექნოლოგიების საფუძვლები",
      dueAt: DUE,
      url: "https://app.kalami.space/quizzes/x",
      unsubscribeUrl: UNSUBSCRIBE,
    }),
  },
  {
    name: "Deadline tomorrow · English",
    email: renderNotificationEmail({
      locale: "en",
      firstName: "Ana",
      kind: "due_24h",
      assessmentKind: "midterm",
      title: "Midterm exam · HTML and CSS basics",
      courseTitle: "Basics of Web Technologies",
      dueAt: DUE,
      url: "https://app.kalami.space/quizzes/y",
      unsubscribeUrl: UNSUBSCRIBE,
    }),
  },
  {
    name: "Student message to a lecturer",
    email: renderStaffMessageEmail({
      locale: "en",
      studentName: "Mariam Tsereteli",
      subject: "Question about Quiz 3",
      context: "Basics of Web Technologies · Week 7",
      body: "Hello,\n\nI couldn't open the quiz on my phone yesterday; it showed a blank page.\nCould I take it today instead?\n\nThank you,\nMariam",
      isReply: false,
      url: "https://staff.kalami.space/inbox/abc",
    }),
  },
  {
    name: "Lecturer replied (to the student)",
    email: renderStudentReplyEmail({
      locale: "ka",
      staffName: "თეა თოდუა",
      subject: "კითხვა ქვიზ 3-ზე",
      url: "https://app.kalami.space/messages/abc",
      unsubscribeUrl: UNSUBSCRIBE,
    }),
  },
];

export function EmailPreviews() {
  const [showText, setShowText] = useState<string | null>(null);
  return (
    <main className="mx-auto w-full max-w-[88rem] px-4 py-10 sm:px-8">
      <h1 className="text-4xl font-medium tracking-tight">Emails</h1>
      <p className="mt-2 max-w-2xl text-graphite">
        Every email Kalami sends, from the real templates with sample data, at a desktop and a phone width. The plain-text
        version is what clients without HTML show.
      </p>
      <ul className="mt-10 space-y-14">
        {EMAILS.map(({ name, email }) => (
          <li key={name}>
            <h2 className="text-xl font-medium tracking-tight">{name}</h2>
            <p className="mt-1 text-sm">
              <span className="text-graphite">Subject:</span> {email.subject}
            </p>
            <div className="mt-4 flex flex-wrap items-start gap-6">
              <iframe title={`${name}, desktop`} srcDoc={email.html} className="h-[820px] w-full max-w-[680px] rounded-2xl border border-line bg-white" />
              <iframe title={`${name}, phone`} srcDoc={email.html} className="h-[820px] w-[375px] max-w-full rounded-2xl border border-line bg-white" />
            </div>
            <button
              type="button"
              className="mt-3 text-sm underline underline-offset-4"
              onClick={() => setShowText(showText === name ? null : name)}
            >
              {showText === name ? "Hide" : "Show"} the plain-text version
            </button>
            {showText === name && (
              <pre className="mt-3 max-w-3xl overflow-x-auto whitespace-pre-wrap rounded-2xl bg-card p-5 text-sm leading-relaxed">{email.text}</pre>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
