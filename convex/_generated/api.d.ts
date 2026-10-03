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
import type * as honesty from "../honesty.js";
import type * as http from "../http.js";
import type * as invites from "../invites.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_honestyNotice from "../lib/honestyNotice.js";
import type * as lib_input from "../lib/input.js";
import type * as lib_tokens from "../lib/tokens.js";
import type * as lib_validators from "../lib/validators.js";
import type * as mcp from "../mcp.js";
import type * as mcpTokens from "../mcpTokens.js";
import type * as model_assessments from "../model/assessments.js";
import type * as model_audit from "../model/audit.js";
import type * as model_courses from "../model/courses.js";
import type * as model_questions from "../model/questions.js";
import type * as questions from "../questions.js";
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
  honesty: typeof honesty;
  http: typeof http;
  invites: typeof invites;
  "lib/access": typeof lib_access;
  "lib/auth": typeof lib_auth;
  "lib/errors": typeof lib_errors;
  "lib/honestyNotice": typeof lib_honestyNotice;
  "lib/input": typeof lib_input;
  "lib/tokens": typeof lib_tokens;
  "lib/validators": typeof lib_validators;
  mcp: typeof mcp;
  mcpTokens: typeof mcpTokens;
  "model/assessments": typeof model_assessments;
  "model/audit": typeof model_audit;
  "model/courses": typeof model_courses;
  "model/questions": typeof model_questions;
  questions: typeof questions;
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
