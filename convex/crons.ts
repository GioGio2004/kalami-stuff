import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Work still in progress when a task closes is graded as it stands (KALAMI.md §11).
crons.interval("auto-submit closed tasks", { minutes: 1 }, internal.learn.autoSubmit, {});

// "Due tomorrow" and "due in an hour" for work that is still open.
crons.interval("deadline reminders", { minutes: 5 }, internal.notifications.remindDue, {});

export default crons;
