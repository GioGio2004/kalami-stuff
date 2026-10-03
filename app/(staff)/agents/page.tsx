import { AgentsView } from "@/components/agents/AgentsView";

// StaffGate (in the layout) only renders this page for signed-in staff.
export default function AgentsPage() {
  return <AgentsView />;
}
