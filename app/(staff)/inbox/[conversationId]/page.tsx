"use client";

import { useMutation, useQuery } from "convex/react";
import { useParams } from "next/navigation";
import { useEffect } from "react";
import { ThreadView } from "@/components/inbox/ThreadView";
import { LoadingScreen } from "@/components/ui/StatusScreen";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

// A conversation that isn't ours makes the query throw NOT_FOUND; the (staff)
// error boundary shows its "not found" screen.
export default function ConversationPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const id = conversationId as Id<"conversations">;
  const thread = useQuery(api.messages.thread, { conversationId: id });
  const reply = useMutation(api.messages.reply);
  const resolve = useMutation(api.messages.resolve);
  const markRead = useMutation(api.messages.markRead);

  // Opening the thread, and every new message while it's open, counts as read.
  const lastMessage = thread?.messages.at(-1)?._id;
  useEffect(() => {
    if (lastMessage !== undefined) {
      markRead({ conversationId: id }).catch(() => {});
    }
  }, [id, lastMessage, markRead]);

  if (thread === undefined) {
    return <LoadingScreen label="Opening conversation" />;
  }
  return (
    <ThreadView
      thread={thread}
      onReply={async (args) => {
        await reply({ conversationId: id, ...args });
      }}
      onResolve={async (resolved) => {
        await resolve({ conversationId: id, resolved });
      }}
    />
  );
}
