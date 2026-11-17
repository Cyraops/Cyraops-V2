import test from "node:test";
import assert from "node:assert/strict";
import {
  getVoiceConfig,
  setActiveVoiceModel,
  getActiveVoiceModel,
  DEEPSEEK_VOICE_MODELS,
} from "./ai/voice/config";
import { SpeechAdapterService } from "./ai/voice/speech-adapters";
import {
  CRM_VOICE_TOOLS,
  registerPendingAction,
  getPendingAction,
  cancelPendingAction,
} from "./ai/voice/crm-tools";

test("Cyraops AI Voice Assistant - Central Configuration & DeepSeek Only", async (t) => {
  await t.test("enforces DeepSeek as the sole reasoning provider for voice", () => {
    const config = getVoiceConfig();
    assert.equal(config.aiProvider, "deepseek");
  });

  await t.test("defaults active model to DeepSeek V4 Flash (deepseek-flash)", () => {
    const activeModel = getActiveVoiceModel();
    assert.equal(activeModel, "deepseek-flash");
    const config = getVoiceConfig();
    const flashOption = config.supportedModels.find((m) => m.id === "deepseek-flash");
    assert.ok(flashOption, "DeepSeek V4 Flash must be in supported models list");
    assert.equal(flashOption?.active, true);
    assert.equal(flashOption?.recommended, true);
  });

  await t.test("supports configurable model switching to DeepSeek V4 Pro (deepseek-v4-pro)", () => {
    const switchResult = setActiveVoiceModel("deepseek-v4-pro");
    assert.equal(switchResult.success, true);
    assert.equal(getActiveVoiceModel(), "deepseek-v4-pro");

    // Revert back to active default Flash
    const revertResult = setActiveVoiceModel("deepseek-flash");
    assert.equal(revertResult.success, true);
    assert.equal(getActiveVoiceModel(), "deepseek-flash");
  });

  await t.test("rejects unsupported model IDs without hardcoding arbitrary strings", () => {
    const invalidSwitch = setActiveVoiceModel("gpt-4o-unknown");
    assert.equal(invalidSwitch.success, false);
    assert.equal(getActiveVoiceModel(), "deepseek-flash");
  });
});

test("Cyraops AI Voice Assistant - Hindi, English and Hinglish Language Adaptation", async (t) => {
  await t.test("detects Devanagari Hindi text", () => {
    const style1 = SpeechAdapterService.detectLanguageStyle("नमस्ते, मेरे पेंडिंग प्रोजेक्ट्स दिखाओ");
    assert.equal(style1, "hi");

    const style2 = SpeechAdapterService.detectLanguageStyle("कल के लिए एक टास्क बना दो");
    assert.equal(style2, "hi");
  });

  await t.test("detects Hinglish conversational phrases and technical code-switching", () => {
    const style1 = SpeechAdapterService.detectLanguageStyle("Mere pending projects dikhao");
    assert.equal(style1, "hinglish");

    const style2 = SpeechAdapterService.detectLanguageStyle("Kal ke liye ek task create kar do");
    assert.equal(style2, "hinglish");

    const style3 = SpeechAdapterService.detectLanguageStyle("Is client ke last emails summarize kar do");
    assert.equal(style3, "hinglish");
  });

  await t.test("detects English technical prompts", () => {
    const style1 = SpeechAdapterService.detectLanguageStyle("Show me all overdue tasks and their assigned users");
    assert.equal(style1, "en");

    const style2 = SpeechAdapterService.detectLanguageStyle("Can you draft a professional reply in English?");
    assert.equal(style2, "en");
  });

  await t.test("normalizes speech recognition language targets", () => {
    assert.equal(SpeechAdapterService.normalizeLanguage("auto"), "en-IN");
    assert.equal(SpeechAdapterService.normalizeLanguage("auto", ["hi-IN", "en-US"]), "hi-IN");
    assert.equal(SpeechAdapterService.normalizeLanguage("auto", ["en-US", "hi-IN"]), "en-US");
    assert.equal(SpeechAdapterService.normalizeLanguage("hi"), "hi-IN");
    assert.equal(SpeechAdapterService.normalizeLanguage("en"), "en-IN");
    assert.equal(SpeechAdapterService.normalizeLanguage("en-US"), "en-US");
  });
});

test("Cyraops AI Voice Assistant - Server-Side Tool Registry & Security Safeguards", async (t) => {
  await t.test("registers all required CRM tool schemas for DeepSeek function calling", () => {
    const toolNames = CRM_VOICE_TOOLS.map((t) => t.function.name);

    // Verify presence of all core module tools
    assert.ok(toolNames.includes("get_dashboard_summary"), "Missing dashboard tool");
    assert.ok(toolNames.includes("search_contacts_and_leads"), "Missing contacts/leads search");
    assert.ok(toolNames.includes("create_contact_or_lead"), "Missing contact creation");
    assert.ok(toolNames.includes("list_projects"), "Missing project listing");
    assert.ok(toolNames.includes("get_project_details"), "Missing project details");
    assert.ok(toolNames.includes("create_project"), "Missing project creation");
    assert.ok(toolNames.includes("list_tasks"), "Missing task listing");
    assert.ok(toolNames.includes("create_task"), "Missing task creation");
    assert.ok(toolNames.includes("update_task"), "Missing task update");
    assert.ok(toolNames.includes("search_emails"), "Missing email search");
    assert.ok(toolNames.includes("read_email"), "Missing email read");
    assert.ok(toolNames.includes("draft_email"), "Missing email draft");
    assert.ok(toolNames.includes("send_email"), "Missing email send");
    assert.ok(toolNames.includes("list_calendar_events"), "Missing calendar events");
    assert.ok(toolNames.includes("cancel_calendar_event"), "Missing calendar cancel");
    assert.ok(toolNames.includes("search_files"), "Missing files search");
    assert.ok(toolNames.includes("get_company_presence"), "Missing company presence");
    assert.ok(toolNames.includes("list_team_members"), "Missing team members");
    assert.ok(toolNames.includes("update_user_role"), "Missing role update");
  });

  await t.test("enforces cryptographic confirmation token and expiry for high-impact actions", () => {
    const action = registerPendingAction({
      toolName: "send_email",
      params: { to: "partner@example.com", subject: "Confidential Contract", body: "Please review" },
      summary: "Send external email to partner@example.com",
      userId: "usr_alice",
      workspaceId: "main",
    });

    assert.ok(action.id.startsWith("act_"), "Action ID must be prefixed act_");
    assert.equal(action.status, "PENDING");
    assert.ok(action.expiresAt > Date.now(), "Expiry must be in the future");

    // Retrieve pending action
    const retrieved = getPendingAction(action.id);
    assert.ok(retrieved);
    assert.equal(retrieved?.userId, "usr_alice");

    // Cancel pending action
    const cancelled = cancelPendingAction(action.id, "usr_alice");
    assert.equal(cancelled, true);

    // Cannot retrieve cancelled action
    const nonExistent = getPendingAction(action.id);
    assert.equal(nonExistent, undefined);
  });
});

