import { DashboardModule } from "@/components/modules/dashboard";
import { ProjectsModule } from "@/components/modules/projects";
import { ChatModule } from "@/components/modules/chat";
import { CalendarModule } from "@/components/modules/calendar";
import { ActivityModule } from "@/components/modules/activity";
import { TeamModule } from "@/components/modules/team";
import { SettingsModule } from "@/components/modules/settings";
import { PublicWebsiteModule } from "@/components/modules/public-website";
import { EmailModule } from "@/components/modules/email";
import { CostModule } from "@/components/modules/cost";
import { CrmModule } from "@/components/modules/crm";

export function WorkspaceView({ section }: { section: string }) {
  const modules: Record<string, React.ReactNode> = {
    dashboard: <DashboardModule />,
    crm: <CrmModule />,
    projects: <ProjectsModule />,
    chat: <ChatModule />,
    email: <EmailModule />,
    calendar: <CalendarModule />,
    activity: <ActivityModule />,
    website: <PublicWebsiteModule />,
    team: <TeamModule />,
    settings: <SettingsModule />,
    cost: <CostModule />,
  };
  return <div key={section} className="fade-in">{modules[section] ?? <DashboardModule />}</div>;
}
