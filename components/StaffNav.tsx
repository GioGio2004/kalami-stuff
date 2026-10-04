"use client";

import { UserButton } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import type { ReactNode } from "react";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { PillHeader } from "@/components/ui/PillHeader";
import { api } from "@/convex/_generated/api";

/** `unread` overrides the live count (the dev gallery has no backend). */
export function StaffNav({ avatar, unread }: { avatar?: ReactNode; unread?: number }) {
  const current = useCurrentUser();
  const live = useQuery(api.messages.unreadCount, current.status === "ready" && unread === undefined ? {} : "skip");
  const canAdmin =
    current.status === "ready" &&
    current.me.memberships.some((m) => m.role === "super_admin" || m.role === "uni_admin");

  return (
    <PillHeader
      homeHref="/courses"
      tag="AntiCheat"
      links={[
        { href: "/courses", label: "Courses" },
        { href: "/groups", label: "Groups" },
        { href: "/inbox", label: "Inbox", badge: unread ?? live },
        { href: "/agents", label: "Agents" },
        ...(canAdmin ? [{ href: "/admin", label: "Admin" }] : []),
      ]}
      actions={avatar ?? <UserButton />}
    />
  );
}
