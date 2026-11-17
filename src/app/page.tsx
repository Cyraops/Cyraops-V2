import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export default async function Home() {
  const [user, workspace] = await Promise.all([currentUser(), db.workspace.findUnique({ where: { id: "main" }, select: { id: true } })]);
  if (!workspace) redirect("/setup");
  redirect(user ? "/dashboard" : "/login");
}
