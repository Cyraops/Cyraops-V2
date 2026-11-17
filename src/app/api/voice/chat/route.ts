import { NextRequest, NextResponse } from "next/server";
import { userFromRequest } from "@/lib/auth";
import { DeepSeekProvider } from "@/lib/ai/providers/deepseek";
import { getActiveVoiceModel, getVoiceConfig } from "@/lib/ai/voice/config";
import { CRM_VOICE_TOOLS, executeCrmTool, setVoicePageContext, PendingAction } from "@/lib/ai/voice/crm-tools";
import type { ChatMessage } from "@/lib/ai/types";

const SYSTEM_VOICE_PROMPT = `You are the official Cyraops CRM AI Voice Assistant.
You control and interact with the Cyraops Company Operating System via natural spoken voice.

CRITICAL RULES:
1. LANGUAGE ADAPTATION (HINDI / ENGLISH / HINGLISH):
   - You automatically understand Hindi (हिन्दी), English, and conversational Hinglish code-switching.
   - Detect the user's spoken language from their query.
   - If the user speaks in Hindi or Hinglish (e.g., "Mere pending projects dikhao", "Kal ke liye ek task add karo", "Client ko email bhejo"), respond in fluent, natural Hindi / Hinglish.
   - If the user speaks in English, respond in professional, friendly English.
   - Maintain common English technical and CRM terminology even in Hindi sentences (e.g., use "Projects", "Tasks", "Deadline", "Email", "Status", "Client", "Lead", "Overdue").
   - Do NOT force unnatural English translation if the user asked in Hindi.

2. VOICE CONVERSATIONAL BREVITY:
   - Your responses are read aloud via Text-to-Speech.
   - Keep answers concise, natural, and crisp (1 to 3 spoken sentences).
   - Avoid massive bulleted dumps or markdown headers unless specifically asked.
   - Summarize key numbers and actionable details directly.

3. PAGE AWARENESS & NAVIGATION:
   - You receive the page the user is currently viewing. Use get_page_context when the user says "this page", "here", or "what am I looking at".
   - Use get_current_record to resolve "this project", "this lead", "this person" or "this email" instead of guessing an id.
   - Use navigate_to when the user asks to open, show, or go to something. Confirm briefly after navigating.
   - Never claim you opened a page unless the navigate_to tool succeeded.

4. CRM DATA & TOOL CALLING:
   - Never invent or hallucinate CRM records.
   - Always call the provided CRM tools to query live data or perform user requests.
   - For high-impact actions (sending external emails, canceling events, updating roles), invoke the tool so the server registers an explicit confirmation card.
   - When an action requires confirmation, inform the user clearly with the action ID and summary and ask them to confirm.

Reasoning Provider: DeepSeek V4 Flash.`;

export async function POST(req: NextRequest) {
  try {
    const user = await userFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized: Invalid or expired session." }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { messages = [], language = "auto", pageContext } = body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: "Invalid request: 'messages' array is required." }, { status: 400 });
    }

    if (pageContext && typeof pageContext === "object") {
      setVoicePageContext(user.id, {
        pathname: typeof pageContext.pathname === "string" ? pageContext.pathname : "",
        query: typeof pageContext.query === "string" ? pageContext.query : "",
      });
    }

    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          error: "DEEPSEEK_API_KEY is not configured in .env. Please configure your DeepSeek API key to use the Voice Assistant.",
          provider: "deepseek",
          configured: false,
        },
        { status: 503 }
      );
    }

    const activeModel = getActiveVoiceModel(); // e.g. "deepseek-chat" (DeepSeek V4 Flash)
    const deepseek = new DeepSeekProvider(apiKey);

    // Format conversation history
    const conversation: ChatMessage[] = [
      { role: "system", content: SYSTEM_VOICE_PROMPT },
      ...messages.slice(-10).map((m: any) => ({
        role: m.role,
        content: m.content || "",
      })),
    ];

    // First round of inference with tools
    const attribution = { userId: user.id, source: "voice", agentSlug: "voice_assistant" };

    let chatResult = await deepseek.chat(conversation, {
      model: activeModel,
      temperature: 0.3,
      tools: CRM_VOICE_TOOLS as any,
      ...attribution,
    });

    let toolExecutions: any[] = [];
    let pendingConfirmation: PendingAction | undefined;

    // Handle tool calling if DeepSeek requested tools
    if (chatResult.toolCalls && chatResult.toolCalls.length > 0) {
      for (const call of chatResult.toolCalls) {
        const execution = await executeCrmTool(call.name, call.arguments, user, "main");
        toolExecutions.push({
          id: call.id,
          name: call.name,
          arguments: call.arguments,
          success: execution.success,
          result: execution.result,
          error: execution.error,
          requiresConfirmation: execution.requiresConfirmation,
        });

        if (execution.requiresConfirmation && execution.pendingAction) {
          pendingConfirmation = execution.pendingAction;
        }
      }

      // Feed tool results back to DeepSeek for natural spoken response synthesis
      const updatedMessages: ChatMessage[] = [
        ...conversation,
        {
          role: "assistant",
          content: chatResult.content || "",
          toolCalls: chatResult.toolCalls,
        },
        ...toolExecutions.map((t) => ({
          role: "tool" as const,
          toolCallId: t.id,
          name: t.name,
          content: JSON.stringify(t.result || { error: t.error }),
        })),
      ];

      chatResult = await deepseek.chat(updatedMessages, {
        model: activeModel,
        temperature: 0.3,
        ...attribution,
      });
    }

    // A navigate_to tool result is rendered by the browser, not the server.
    const navigateTo = toolExecutions
      .map((execution) => execution?.result?.navigateTo)
      .find((href) => typeof href === "string");

    return NextResponse.json({
      success: true,
      model: activeModel,
      provider: "deepseek",
      response: chatResult.content,
      toolExecutions: toolExecutions.length > 0 ? toolExecutions : undefined,
      requiresConfirmation: Boolean(pendingConfirmation),
      pendingAction: pendingConfirmation,
      navigateTo: navigateTo || undefined,
      usage: chatResult.usage,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        error: `DeepSeek Voice Assistant error: ${err?.message || err}`,
        provider: "deepseek",
      },
      { status: 500 }
    );
  }
}

