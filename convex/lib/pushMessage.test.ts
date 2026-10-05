import { describe, expect, test } from "vitest";
import { notificationPushMessage, testPushMessage } from "./pushMessage";

const base = {
  notificationId: "n1",
  assessmentKind: "quiz" as const,
  title: "Warm-up quiz",
  courseTitle: "Web basics",
  href: "/quizzes/a1",
  studentAppUrl: "https://app.kalami.space/",
};

describe("notificationPushMessage", () => {
  test("new work, in English and Georgian, with the page to open", () => {
    const en = notificationPushMessage({ ...base, locale: "en", kind: "published" });
    expect(en).toEqual({
      title: "New quiz: Warm-up quiz",
      body: "Web basics",
      url: "https://app.kalami.space/quizzes/a1",
      tag: "notification:n1",
      lang: "en",
    });
    const ka = notificationPushMessage({ ...base, locale: "ka", kind: "published", assessmentKind: "task" });
    expect(ka.title).toBe("ახალი დავალება: Warm-up quiz");
    expect(ka.lang).toBe("ka");
  });

  test("reminders say when it's due, in Tbilisi time", () => {
    const dueAt = Date.UTC(2026, 9, 7, 10, 0); // 14:00 in Tbilisi
    const en = notificationPushMessage({ ...base, locale: "en", kind: "due_24h", dueAt });
    expect(en.title).toBe("Due tomorrow: Warm-up quiz");
    expect(en.body).toMatch(/^Web basics · Due .*14:00$/);
    const ka = notificationPushMessage({ ...base, locale: "ka", kind: "due_1h", dueAt });
    expect(ka.title).toBe("1 საათი დარჩა: Warm-up quiz");
    expect(ka.body).toContain("ბოლო ვადა:");
  });

  test("the test push opens the dashboard", () => {
    expect(testPushMessage("en", "https://app.kalami.space")).toMatchObject({ url: "https://app.kalami.space/dashboard", tag: "test" });
    expect(testPushMessage("ka", "http://localhost:3100").title).toContain("Kalami");
  });
});
