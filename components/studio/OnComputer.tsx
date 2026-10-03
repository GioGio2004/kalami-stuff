"use client";

import { Button } from "@/components/ui/buttons";
import { Monitor } from "@/components/ui/icons";
import { FullScreen } from "./TaskTryout";

/** Instead of a code editor on phones and tablets: code tasks are written, tried and reviewed on a computer. */
export function OnComputer({ what, onClose }: { what: string; onClose: () => void }) {
  return (
    <FullScreen label="Open on a computer" onClose={onClose}>
      <div className="grid h-full place-items-center p-4">
        <div className="max-w-sm text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-panel">
            <Monitor className="size-6" />
          </span>
          <h2 className="mt-5 text-2xl font-medium tracking-tight">Open this on a computer</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-graphite">
            {what} needs a keyboard and room for the editor and the preview, so it only opens on a computer.
          </p>
          <Button className="mt-6" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </FullScreen>
  );
}
