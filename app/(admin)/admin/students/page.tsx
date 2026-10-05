"use client";

import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { useState } from "react";
import { useAdminScope } from "@/components/admin/panel/AdminScope";
import { StudentDetailDialog } from "@/components/admin/panel/StudentDetail";
import { StudentsView } from "@/components/admin/panel/StudentsView";
import { listStatusOf } from "@/components/admin/types";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useDebounced } from "@/lib/useDebounced";

const PAGE = 40;

export default function StudentsPage() {
  const scope = useAdminScope();
  const [query, setQuery] = useState("");
  const searched = useDebounced(query);
  const searching = searched.trim().length >= 2;
  const list = usePaginatedQuery(api.platform.students, scope.ready && !searching ? { university: scope.filter } : "skip", {
    initialNumItems: PAGE,
  });
  const found = useQuery(api.platform.findStudents, scope.ready && searching ? { university: scope.filter, query: searched } : "skip");
  const [openId, setOpenId] = useState<Id<"users"> | null>(null);
  const detail = useQuery(api.platform.student, openId === null ? "skip" : { userId: openId });
  const setEnrollment = useMutation(api.platform.setEnrollmentStatus);
  const saveProfile = useMutation(api.platform.updateStudentProfile);

  return (
    <>
      <StudentsView
        rows={searching ? (searched === query ? found : undefined) : list.status === "LoadingFirstPage" ? undefined : list.results}
        status={listStatusOf(list.status)}
        onLoadMore={() => list.loadMore(PAGE)}
        query={query}
        onQuery={setQuery}
        searching={searching}
        scopeLabel={scope.label}
        onOpen={setOpenId}
      />
      <StudentDetailDialog
        detail={detail}
        open={openId !== null}
        onClose={() => setOpenId(null)}
        universities={scope.universities}
        isSuperAdmin={scope.isSuperAdmin}
        actions={{
          onSetEnrollment: async (enrollmentId, status) => {
            await setEnrollment({ enrollmentId, status });
          },
          onSaveProfile: async (args) => {
            if (openId === null) return;
            await saveProfile({ userId: openId, ...args });
          },
        }}
      />
    </>
  );
}
