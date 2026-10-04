"use client";

import { UserButton } from "@clerk/nextjs";
import type { ReactNode } from "react";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { PillHeader } from "@/components/ui/PillHeader";

export function StaffNav({ avatar }: { avatar?: ReactNode }) {
  const current = useCurrentUser();
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
        { href: "/agents", label: "Agents" },
        ...(canAdmin ? [{ href: "/admin", label: "Admin" }] : []),
      ]}
      actions={avatar ?? <UserButton />}
    />
  );
}
