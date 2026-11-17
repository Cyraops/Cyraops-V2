import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { TeamGoals } from "@/components/ai/team-goals";
import { SectionTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <SectionTitle
        eyebrow="AI team"
        title="Goals"
        subtitle="Set an objective and the AI teammates plan, delegate to each other and keep working until it is done."
      />
      <TeamGoals />
    </div>
  );
}
