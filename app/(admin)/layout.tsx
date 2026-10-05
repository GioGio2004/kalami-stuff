import type { ReactNode } from "react";
import { AdminArea } from "@/components/admin/panel/AdminArea";
import { StaffGate } from "@/components/StaffGate";

/**
 * The admin panel lives apart from the staff app's pages: its own frame with a
 * sidebar instead of the pill header. StaffGate signs people in; AdminArea
 * keeps non-admins out and frames the pages.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <StaffGate>
      <AdminArea>{children}</AdminArea>
    </StaffGate>
  );
}
