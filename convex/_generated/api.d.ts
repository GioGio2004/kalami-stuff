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
import type * as honesty from "../honesty.js";
import type * as http from "../http.js";
import type * as invites from "../invites.js";
import type * as learn from "../learn.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_checks_css from "../lib/checks/css.js";
import type * as lib_checks_index from "../lib/checks/index.js";
import type * as lib_checks_page from "../lib/checks/page.js";
import type * as lib_checks_run from "../lib/checks/run.js";
import type * as lib_checks_types from "../lib/checks/types.js";
import type * as lib_checks_values from "../lib/checks/values.js";
import type * as lib_checks_variants from "../lib/checks/variants.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_honestyNotice from "../lib/honestyNotice.js";
import type * as lib_input from "../lib/input.js";
import type * as lib_integrity from "../lib/integrity.js";
import type * as lib_tokens from "../lib/tokens.js";
import type * as lib_validators from "../lib/validators.js";
import type * as mcp from "../mcp.js";
import type * as model_assessments from "../model/assessments.js";
import type * as model_audit from "../model/audit.js";
import type * as model_codeTasks from "../model/codeTasks.js";
import type * as model_courses from "../model/courses.js";
import type * as model_learn from "../model/learn.js";
import type * as model_questions from "../model/questions.js";
import type * as questions from "../questions.js";
import type * as submissions from "../submissions.js";
import type * as universities from "../universities.js";
import type * as users from "../users.js";

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
  honesty: typeof honesty;
  http: typeof http;
  invites: typeof invites;
  learn: typeof learn;
  "lib/access": typeof lib_access;
  "lib/auth": typeof lib_auth;
  "lib/checks/css": typeof lib_checks_css;
  "lib/checks/index": typeof lib_checks_index;
  "lib/checks/page": typeof lib_checks_page;
  "lib/checks/run": typeof lib_checks_run;
  "lib/checks/types": typeof lib_checks_types;
  "lib/checks/values": typeof lib_checks_values;
  "lib/checks/variants": typeof lib_checks_variants;
  "lib/errors": typeof lib_errors;
  "lib/honestyNotice": typeof lib_honestyNotice;
  "lib/input": typeof lib_input;
  "lib/integrity": typeof lib_integrity;
  "lib/tokens": typeof lib_tokens;
  "lib/validators": typeof lib_validators;
  mcp: typeof mcp;
  "model/assessments": typeof model_assessments;
  "model/audit": typeof model_audit;
  "model/codeTasks": typeof model_codeTasks;
  "model/courses": typeof model_courses;
  "model/learn": typeof model_learn;
  "model/questions": typeof model_questions;
  questions: typeof questions;
  submissions: typeof submissions;
  universities: typeof universities;
  users: typeof users;
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

export declare const components: {};
