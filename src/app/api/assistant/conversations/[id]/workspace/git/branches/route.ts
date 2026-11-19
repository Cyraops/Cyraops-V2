import { NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/validators";
import { listBranches } from "@/lib/harness/workspace-git";
import { resolveWorkspaceGitContext } from "../_lib";

type Context = { params: Promise<{ id: string }> };

/**
 * Workspace git: list branches (`git branch -a --no-color`) for the branch
 * pill and the Switch… menu. Owner-only and same-origin like every sibling
 * workspace route; the root is the conversation's stored realpath.
 *
 * GET → { current, branches[] }
 */
export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  const resolved = await resolveWorkspaceGitContext(request, id);
  if (resolved.error) return resolved.error;
  const { root } = resolved.context as NonNullable<typeof resolved.context>;

  try {
    const list = await listBranches(root);
    return NextResponse.json(list);
  } catch (error) {
    console.error("[API:workspace/git/branches] Failed:", error);
    return jsonError("Failed to read git branches", 500);
  }
}
