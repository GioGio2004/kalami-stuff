"use client";

import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { useState } from "react";
import { useAdminScope } from "@/components/admin/panel/AdminScope";
import { CourseDetailDialog } from "@/components/admin/panel/CourseDetail";
import { CoursesView, type CourseStatusFilter } from "@/components/admin/panel/CoursesView";
import { listStatusOf } from "@/components/admin/types";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useDebounced } from "@/lib/useDebounced";

const PAGE = 40;

export default function CoursesPage() {
  const scope = useAdminScope();
  const [statusFilter, setStatusFilter] = useState<CourseStatusFilter>("all");
  const [query, setQuery] = useState("");
  const searched = useDebounced(query);
  const searching = searched.trim() !== "";
  const list = usePaginatedQuery(
    api.platform.courses,
    scope.ready && !searching ? { university: scope.filter, status: statusFilter === "all" ? undefined : statusFilter } : "skip",
    { initialNumItems: PAGE },
  );
  const found = useQuery(api.platform.findCourses, scope.ready && searching ? { university: scope.filter, query: searched } : "skip");
  const [openId, setOpenId] = useState<Id<"courses"> | null>(null);
  const detail = useQuery(api.platform.course, openId === null ? "skip" : { courseId: openId });
  const updateCourse = useMutation(api.courses.update);
  const setJoining = useMutation(api.courses.setJoining);
  const newJoinCode = useMutation(api.courses.newJoinCode);
  const removeCourse = useMutation(api.courses.remove);
  const transfer = useMutation(api.platform.transferCourse);
  const setAssessmentStatus = useMutation(api.assessments.setStatus);

  return (
    <>
      <CoursesView
        rows={searching ? (searched === query ? found : undefined) : list.status === "LoadingFirstPage" ? undefined : list.results}
        status={listStatusOf(list.status)}
        onLoadMore={() => list.loadMore(PAGE)}
        statusFilter={statusFilter}
        onStatusFilter={setStatusFilter}
        query={query}
        onQuery={setQuery}
        searching={searching}
        scopeLabel={scope.label}
        onOpen={setOpenId}
      />
      <CourseDetailDialog
        detail={openId === null ? undefined : detail}
        open={openId !== null}
        onClose={() => setOpenId(null)}
        actions={{
          onSetStatus: async (status) => {
            if (openId !== null) await updateCourse({ courseId: openId, status });
          },
          onSetJoining: async (enabled) => {
            if (openId !== null) await setJoining({ courseId: openId, enabled });
          },
          onNewJoinCode: async () => {
            if (openId !== null) await newJoinCode({ courseId: openId });
          },
          onTransfer: async (newOwnerEmail) => {
            if (openId !== null) await transfer({ courseId: openId, newOwnerEmail });
          },
          onDelete: async () => {
            if (openId === null) return;
            await removeCourse({ courseId: openId });
            setOpenId(null);
          },
          onSetAssessmentStatus: async (assessmentId, status) => {
            await setAssessmentStatus({ assessmentId, status });
          },
        }}
      />
    </>
  );
}
