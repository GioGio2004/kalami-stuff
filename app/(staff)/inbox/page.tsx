"use client";

import { useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { InboxView } from "@/components/inbox/InboxView";
import { api } from "@/convex/_generated/api";

export default function InboxPage() {
  const current = useCurrentUser();
  const items = useQuery(api.messages.inbox, current.status === "ready" ? {} : "skip");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // StaffGate only renders this page for signed-in staff.
  if (current.status !== "ready") {
    return null;
  }
  return <InboxView items={items} now={now} />;
}
