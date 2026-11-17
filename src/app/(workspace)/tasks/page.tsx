import { TicketDesk } from "@/components/modules/ticket-desk";

export const metadata = {
  title: "Tickets | Cyraops CRM",
  description: "Every ticket in one place: what came in, who owns it, and how it was resolved.",
};

export default function TasksPage() {
  return <TicketDesk />;
}
