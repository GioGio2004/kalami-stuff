/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as assessments from "../assessments.js";
import type * as audit from "../audit.js";
import type * as courses from "../courses.js";
import type * as crons from "../crons.js";
import type * as drive from "../drive.js";
import type * as email from "../email.js";
import type * as groups from "../groups.js";
import type * as honesty from "../honesty.js";
import type * as http from "../http.js";
import type * as invites from "../invites.js";
import type * as kalami from "../kalami.js";
import type * as learn from "../learn.js";
import type * as lessons from "../lessons.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_checks_css from "../lib/checks/css.js";
import type * as lib_checks_index from "../lib/checks/index.js";
import type * as lib_checks_page from "../lib/checks/page.js";
import type * as lib_checks_run from "../lib/checks/run.js";
import type * as lib_checks_types from "../lib/checks/types.js";
import type * as lib_checks_values from "../lib/checks/values.js";
import type * as lib_checks_variants from "../lib/checks/variants.js";
import type * as lib_contentSchemas from "../lib/contentSchemas.js";
import type * as lib_email_templates from "../lib/email/templates.js";
import type * as lib_email_time from "../lib/email/time.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_google from "../lib/google.js";
import type * as lib_grading from "../lib/grading.js";
import type * as lib_honestyNotice from "../lib/honestyNotice.js";
import type * as lib_input from "../lib/input.js";
import type * as lib_integrity from "../lib/integrity.js";
import type * as lib_kalami from "../lib/kalami.js";
import type * as lib_limits from "../lib/limits.js";
import type * as lib_tokens from "../lib/tokens.js";
import type * as lib_validators from "../lib/validators.js";
import type * as mcp from "../mcp.js";
import type * as messages from "../messages.js";
import type * as migrations from "../migrations.js";
import type * as model_agentRequests from "../model/agentRequests.js";
import type * as model_assessments from "../model/assessments.js";
import type * as model_audit from "../model/audit.js";
import type * as model_codeTasks from "../model/codeTasks.js";
import type * as model_coursePurge from "../model/coursePurge.js";
import type * as model_courses from "../model/courses.js";
import type * as model_enrollments from "../model/enrollments.js";
import type * as model_groups from "../model/groups.js";
import type * as model_kalami from "../model/kalami.js";
import type * as model_kalamiImport from "../model/kalamiImport.js";
import type * as model_learn from "../model/learn.js";
import type * as model_lessons from "../model/lessons.js";
import type * as model_messages from "../model/messages.js";
import type * as model_notifications from "../model/notifications.js";
import type * as model_outline from "../model/outline.js";
import type * as model_platform from "../model/platform.js";
import type * as model_questions from "../model/questions.js";
import type * as model_quiz from "../model/quiz.js";
import type * as model_weeks from "../model/weeks.js";
import type * as notifications from "../notifications.js";
import type * as ops from "../ops.js";
import type * as people from "../people.js";
import type * as platform from "../platform.js";
import type * as questions from "../questions.js";
import type * as submissions from "../submissions.js";
import type * as universities from "../universities.js";
import type * as users from "../users.js";
import type * as weeks from "../weeks.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  assessments: typeof assessments;
  audit: typeof audit;
  courses: typeof courses;
  crons: typeof crons;
  drive: typeof drive;
  email: typeof email;
  groups: typeof groups;
  honesty: typeof honesty;
  http: typeof http;
  invites: typeof invites;
  kalami: typeof kalami;
  learn: typeof learn;
  lessons: typeof lessons;
  "lib/access": typeof lib_access;
  "lib/auth": typeof lib_auth;
  "lib/checks/css": typeof lib_checks_css;
  "lib/checks/index": typeof lib_checks_index;
  "lib/checks/page": typeof lib_checks_page;
  "lib/checks/run": typeof lib_checks_run;
  "lib/checks/types": typeof lib_checks_types;
  "lib/checks/values": typeof lib_checks_values;
  "lib/checks/variants": typeof lib_checks_variants;
  "lib/contentSchemas": typeof lib_contentSchemas;
  "lib/email/templates": typeof lib_email_templates;
  "lib/email/time": typeof lib_email_time;
  "lib/errors": typeof lib_errors;
  "lib/google": typeof lib_google;
  "lib/grading": typeof lib_grading;
  "lib/honestyNotice": typeof lib_honestyNotice;
  "lib/input": typeof lib_input;
  "lib/integrity": typeof lib_integrity;
  "lib/kalami": typeof lib_kalami;
  "lib/limits": typeof lib_limits;
  "lib/tokens": typeof lib_tokens;
  "lib/validators": typeof lib_validators;
  mcp: typeof mcp;
  messages: typeof messages;
  migrations: typeof migrations;
  "model/agentRequests": typeof model_agentRequests;
  "model/assessments": typeof model_assessments;
  "model/audit": typeof model_audit;
  "model/codeTasks": typeof model_codeTasks;
  "model/coursePurge": typeof model_coursePurge;
  "model/courses": typeof model_courses;
  "model/enrollments": typeof model_enrollments;
  "model/groups": typeof model_groups;
  "model/kalami": typeof model_kalami;
  "model/kalamiImport": typeof model_kalamiImport;
  "model/learn": typeof model_learn;
  "model/lessons": typeof model_lessons;
  "model/messages": typeof model_messages;
  "model/notifications": typeof model_notifications;
  "model/outline": typeof model_outline;
  "model/platform": typeof model_platform;
  "model/questions": typeof model_questions;
  "model/quiz": typeof model_quiz;
  "model/weeks": typeof model_weeks;
  notifications: typeof notifications;
  ops: typeof ops;
  people: typeof people;
  platform: typeof platform;
  questions: typeof questions;
  submissions: typeof submissions;
  universities: typeof universities;
  users: typeof users;
  weeks: typeof weeks;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
  resend: import("@convex-dev/resend/_generated/component.js").ComponentApi<"resend">;
};
