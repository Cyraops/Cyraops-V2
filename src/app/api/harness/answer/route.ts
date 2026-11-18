import { NextRequest, NextResponse } from "next/server";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { questionBroker } from "@/lib/harness/question-broker";

/**
 * The answer endpoint for harness ask_user_question turns (TASK 1).
 *
 * When the model calls ask_user_question, the chat SSE emits a
 * `{ type: "question", questionId, text }` payload and the harness answerer
 * waterfall holds the turn open (the cyraops-crm plugin bridges the
 * user-questions/request waterfall to the in-process question broker). This
 * route resolves the pending question with the user's typed text, which the
 * answerer returns as the tool result's answer batch — the turn then
 * continues on the same SSE connection and the model receives the answer.
 *
 * Auth mirrors /api/harness/approve: same-origin check first (CSRF), then the
 * session user. Unknown or already-settled question ids answer 404.
 */

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const body = await request.json().catch(() => null);
  const questionId = typeof body?.questionId === "string" ? body.questionId.trim() : "";
  const answer = typeof body?.answer === "string" ? body.answer : "";

  if (!questionId) return jsonError("Question id is required", 400);
  if (!answer.trim()) return jsonError("An answer is required", 400);
  if (answer.length > 2000) return jsonError("The answer is too long (maximum 2000 characters)", 400);

  try {
    const result = questionBroker().answer(questionId, answer);
    return NextResponse.json({
      success: true,
      questionId,
      answered: result.batch.answers.length,
    });
  } catch (error) {
    console.error("[API:harness/answer] Failed:", error);
    if (/not found|already answered/i.test(String((error as { message?: string })?.message ?? ""))) {
      return jsonError("Question request not found or already answered", 404);
    }
    return jsonError("Failed to record the answer", 500);
  }
}
