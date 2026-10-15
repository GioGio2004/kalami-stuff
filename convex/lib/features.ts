import type { Doc } from "../_generated/dataModel";
import type { Actor } from "./access";
import { isSuperAdmin } from "./auth";
import { appError } from "./errors";
import { FEATURE_INFO, FEATURES } from "./featureInfo";
import type { Feature } from "./validators";

/**
 * Features switched on per person. Some tools are only for the teachers the
 * super admin chooses (Admin → People → Features); the list lives on the
 * person (`users.features`). The super admin has every feature. Without one,
 * its buttons don't show, its agent tools aren't offered, and the backend
 * refuses its calls; what students already see keeps working.
 */

export function hasFeature(user: Doc<"users">, memberships: Doc<"memberships">[], feature: Feature): boolean {
  return isSuperAdmin(memberships) || (user.features ?? []).includes(feature);
}

export function actorHas(actor: Actor, feature: Feature): boolean {
  return hasFeature(actor.user, actor.memberships, feature);
}

export function requireFeature(actor: Actor, feature: Feature): void {
  if (!actorHas(actor, feature)) {
    throw appError(
      "FORBIDDEN",
      `${FEATURE_INFO[feature].label} aren't switched on for your account. Ask the Kalami administrator to turn them on.`,
    );
  }
}

export { FEATURE_INFO };

/** Every feature this person has (the super admin: all of them). */
export function featuresOf(user: Doc<"users">, memberships: Doc<"memberships">[]): Feature[] {
  return FEATURES.filter((feature) => hasFeature(user, memberships, feature));
}
