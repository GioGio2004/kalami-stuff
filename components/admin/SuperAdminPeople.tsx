"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import type { AdminUniversity } from "@/components/admin/types";
import { PeoplePanel } from "@/components/admin/PeoplePanel";
import { api } from "@/convex/_generated/api";

/** The super admin's people search, wired to the backend. */
export function SuperAdminPeople({ universities }: { universities: AdminUniversity[] | undefined }) {
  const [query, setQuery] = useState("");
  // Searching waits for a pause in typing.
  const [searched, setSearched] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearched(query), 250);
    return () => clearTimeout(timer);
  }, [query]);
  const people = useQuery(api.people.search, searched.trim().length >= 2 ? { query: searched } : "skip");
  const changeRole = useMutation(api.people.changeStaffRole);
  const removeRole = useMutation(api.people.removeStaffRole);
  return (
    <PeoplePanel
      query={query}
      onQuery={setQuery}
      people={searched === query ? people : undefined}
      universities={universities}
      onChange={async (membershipId, role, universityId) => {
        await changeRole({ membershipId, role, universityId });
      }}
      onRemove={async (membershipId) => {
        await removeRole({ membershipId });
      }}
    />
  );
}
