import { NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/validators";
import { getDiff, getDiffStat, GitArgError, validateGitFilePath } from "@/lib/harness/workspace-git";
import { resolveWorkspaceRelativePath, WorkspacePathError, workspaceRelPath } from "@/lib/harness/workspace-root";
import { gitFriendlyError, resolveWorkspaceGitContext } from "../_lib";

type Context = { params: Promise<{ id: string }> };

/**
 * Workspace git: the unstaged diff for one workspace-relative path
 * (`git diff --unified=3 -- <path>`), plus the working-tree `git diff --stat`
 * summary. The path is validated lexically (no `..`/leading `-`/absolute, ≤ 200
 * chars) and by realpath to stay inside the stored root, exactly like the file
 * read route, before any git process runs.
 *
 * GET ?path=<rel> → { path, rawText, stat }
 */
export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  const resolved = await resolveWorkspaceGitContext(request, id);
  if (resolved.error) return resolved.error;
  const { root } = resolved.context as NonNullable<typeof resolved.context>;

  const rel = workspaceRelPath(new URL(request.url).searchParams.get("path"));
  // Lexical gate (rejects empty, leading `-`, traversal, absolute, bad charset)…
  try {
    validateGitFilePath(rel);
  } catch (error) {
    if (error instanceof GitArgError) return jsonError(error.message, 400);
    throw error;
  }

  // …then the realpath containment check (the file must exist inside the root).
  try {
    await resolveWorkspaceRelativePath({ root, rel });
  } catch (error) {
    if (error instanceof WorkspacePathError) {
      return jsonError(error.message, error.code === "NOT_FOUND" ? 404 : 400);
    }
    throw error;
  }

  try {
    const diff = await getDiff(root, rel);
    const { stat } = await getDiffStat(root);
    return NextResponse.json({ path: diff.path, rawText: diff.rawText, stat });
  } catch (error) {
    console.error("[API:workspace/git/diff] Failed:", error);
    return jsonError(gitFriendlyError(error), 500);
  }
}
