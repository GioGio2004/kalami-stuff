import type { ReactNode } from "react";
import { StaffGate } from "@/components/StaffGate";
import { StaffNav } from "@/components/StaffNav";

export default function StaffLayout({ children }: { children: ReactNode }) {
  return (
    <StaffGate>
      <StaffNav />
      <main className="mx-auto w-full max-w-[88rem] flex-1 px-3 pb-10 pt-5 sm:px-6">{children}</main>
    </StaffGate>
  );
}
