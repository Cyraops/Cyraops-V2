import { NextRequest, NextResponse } from "next/server";
import { userFromRequest } from "@/lib/auth";
import { getVoiceConfig, setActiveVoiceModel, DEEPSEEK_VOICE_MODELS } from "@/lib/ai/voice/config";

export async function GET(req: NextRequest) {
  try {
    const user = await userFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const config = getVoiceConfig();
    const isDeepSeekConfigured = Boolean(process.env.DEEPSEEK_API_KEY?.trim());

    return NextResponse.json({
      success: true,
      provider: config.aiProvider,
      activeModel: config.activeModel,
      isConfigured: isDeepSeekConfigured,
      models: config.supportedModels,
      speech: config.speech,
      audioAnalysis: config.audioAnalysis,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await userFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Role check: Only Owner or Admin can switch active model configuration
    if (user.role !== "OWNER" && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden: Only workspace admins can change AI model settings." }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const { modelId } = body;

    if (!modelId) {
      return NextResponse.json({ error: "Missing 'modelId' in request body." }, { status: 400 });
    }

    const result = setActiveVoiceModel(modelId);
    if (!result.success) {
      return NextResponse.json({ error: result.message }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      activeModel: result.activeModel,
      message: result.message,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

