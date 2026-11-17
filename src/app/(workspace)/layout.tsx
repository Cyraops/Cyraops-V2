import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { WorkspaceShell } from "@/components/workspace-shell";
import { ToastProvider } from "@/components/ui";

/**
 * Every signed-in page is wrapped in the toast provider.
 *
 * It was defined but never mounted, so `useToast()` returned a no-op and the
 * whole workspace had silent feedback: no confirmation when something saved,
 * no message when it failed. Mounted here rather than inside the shell so a
 * page rendered outside the shell still gets it.
 */
export default async function ProtectedLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const workspace = await db.workspace.findUnique({ where: { id: "main" }, select: { name: true } });
  return (
    <ToastProvider>
      <WorkspaceShell user={user} workspaceName={workspace?.name ?? "Cyraops"}>{children}</WorkspaceShell>
    </ToastProvider>
  );
}
