"use client";

import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui/buttons";
import { errorMessage } from "@/lib/errors";

/** Catches thrown queries (missing course, no access) and failed renders under /courses and /agents. */
export default function StaffError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="rounded-[2.75rem] bg-panel px-6 py-14 sm:px-12">
      <p className="-rotate-2 font-hand text-[1.8rem] leading-none text-graphite">Hmm</p>
      <h1 className="mt-3 text-4xl font-medium tracking-[-0.04em] sm:text-5xl">That page didn’t open</h1>
      <p className="mt-4 max-w-md text-lg text-graphite">{errorMessage(error)}</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <ButtonLink href="/courses">Back to my courses</ButtonLink>
        <Button variant="outline" onClick={() => retry()}>
          Try again
        </Button>
      </div>
    </div>
  );
}
