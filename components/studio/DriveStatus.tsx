"use client";

import { Button } from "@/components/ui/buttons";
import { ArrowUpRight } from "@/components/ui/icons";
import type { CourseOutline, DriveConnection, OutlineWeek } from "./types";

/**
 * Google Drive in the course outline. Files stay in the lecturer's own Drive:
 * Kalami makes a private course folder with a folder per week, and publishing
 * a week shares just that folder by link. Only the person who set it up can
 * create or share folders; anyone may add links.
 */

/** Whether the viewer can create Drive folders in this course right now. */
export function canUseDrive(data: CourseOutline, connection: DriveConnection | undefined): boolean {
  return (
    data.canEdit &&
    data.driveAvailable &&
    (data.drive === null || data.drive.mine) &&
    connection?.connected === true
  );
}

/** The strip under the outline's title: connect Drive, or where the course's folders live. */
export function DriveStrip({
  data,
  connection,
  connecting,
  onConnect,
  onMoveToMyDrive,
}: {
  data: CourseOutline;
  connection: DriveConnection | undefined;
  connecting: boolean;
  onConnect: () => void;
  onMoveToMyDrive: () => void;
}) {
  if (!data.driveAvailable) {
    return (
      <p className="rounded-2xl bg-panel px-4 py-3 text-sm text-graphite">
        Google Drive isn&apos;t switched on for this Kalami server yet. Add links to materials hosted anywhere.
      </p>
    );
  }
  if (data.drive !== null && !data.drive.mine) {
    return (
      <div className="rounded-2xl bg-panel px-4 py-3 text-sm text-graphite">
        <div className="flex items-start gap-3">
          <DriveMark />
          <p className="min-w-0">
            This course&apos;s folders live in {data.drive.ownerName}&apos;s Google Drive, so only they can add or share
            Drive folders. You can still write lessons and add links.
          </p>
        </div>
        {data.drive.canTakeOver && connection?.connected && (
          <div className="mt-3 flex flex-wrap items-center gap-3 pl-11">
            <Button size="sm" variant="outline" onClick={onMoveToMyDrive}>
              Move to my Drive
            </Button>
            <span className="text-xs">
              Kalami makes new folders for every week in your Drive, and those weeks go back to draft. The old folders
              stay where they are.
            </span>
          </div>
        )}
      </div>
    );
  }
  if (connection === undefined) {
    return <p className="rounded-2xl bg-panel px-4 py-3 text-sm text-graphite">Checking your Google Drive…</p>;
  }
  if (!connection.connected) {
    return (
      <div className="rounded-2xl bg-highlighter/45 p-4 sm:flex sm:items-center sm:gap-4">
        <div className="flex gap-3 sm:min-w-0 sm:flex-1">
          <DriveMark />
          <div className="min-w-0">
            <p className="font-medium">Connect Google Drive</p>
            <p className="mt-0.5 text-sm leading-relaxed text-ink/75">
              For slides and files: they stay in your own Drive. Kalami creates a folder for this course with one folder
              per week, and shares a week&apos;s folder by link when you publish the week. It can only see folders it
              created.
            </p>
            {connection.problem && !connection.problem.startsWith("Connect Google Drive") && (
              <p className="mt-1 text-sm text-red-pen">{connection.problem}</p>
            )}
          </div>
        </div>
        <Button onClick={onConnect} disabled={connecting} className="mt-4 w-full sm:mt-0 sm:w-auto">
          {connecting ? "Opening Google…" : "Connect Drive"}
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-panel px-4 py-3 text-sm">
      <DriveMark />
      <span className="min-w-0 flex-1 basis-48 text-graphite">
        Google Drive connected.{" "}
        {data.drive?.folderUrl
          ? "Upload files into each week's folder in Drive."
          : "Add a Drive folder to a week and Kalami creates the course folder in your Drive."}
      </span>
      {data.drive?.folderUrl && (
        <a
          href={data.drive.folderUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-full font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          Course folder
          <ArrowUpRight className="size-4" />
        </a>
      )}
    </div>
  );
}

/** Drive's three-colour triangle, drawn simply (Google's own brand colours). */
export function DriveMark({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`shrink-0 ${className}`}>
      <path d="M8.2 3h7.6l6 10.4h-7.6z" fill="#FBBC04" />
      <path d="M2.2 13.4 8.2 3l3.8 6.6-6 10.4z" fill="#34A853" />
      <path d="M6 20l3.8-6.6h12L18 20z" fill="#4285F4" />
    </svg>
  );
}

type WeekDrive = NonNullable<OutlineWeek["drive"]>;

/** A Drive job is running (and hasn't stalled), so publish/unpublish/remove wait for it. */
export function driveBusy(drive: OutlineWeek["drive"]): boolean {
  return drive !== null && drive.syncing !== undefined && !drive.stale;
}

/** One line on where the week's folder stands, for the lecturer. */
export function folderStatus(drive: WeekDrive, weekStatus: OutlineWeek["status"]): { text: string; problem: boolean } {
  if (drive.error) return { text: drive.error, problem: true };
  if (drive.stale) return { text: "Google Drive stopped answering. Try again.", problem: true };
  if (drive.syncing === "folder") return { text: "Creating the folder in your Drive…", problem: false };
  if (drive.syncing === "share") return { text: "Sharing the folder…", problem: false };
  if (drive.syncing === "unshare") return { text: "Taking the sharing off…", problem: false };
  if (weekStatus === "published" && drive.shared) {
    return { text: "Students can open it (anyone with the link can view)", problem: false };
  }
  return { text: "Private. Upload files to it in Drive; students get it when you publish the week.", problem: false };
}
