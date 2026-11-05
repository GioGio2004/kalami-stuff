"use client";

import { useQuery } from "convex/react";
import { useParams } from "next/navigation";
import { GradingDesk } from "@/components/studio/GradingDesk";
import { LoadingScreen } from "@/components/ui/StatusScreen";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

/** The grading desk: one assessment's submissions, one student at a time. */
export default function GradingPage() {
  const params = useParams<{ assessmentId: string }>();
  const detail = useQuery(api.assessments.get, { assessmentId: params.assessmentId as Id<"assessments"> });
  if (detail === undefined) {
    return <LoadingScreen label="Opening the grading desk" />;
  }
  return <GradingDesk detail={detail} />;
}
