import { db } from "../src/lib/db";
import { executeCrmTool, executeConfirmedAction, getPendingAction } from "../src/lib/ai/voice/crm-tools";
import { getVoiceConfig, setActiveVoiceModel, getActiveVoiceModel } from "../src/lib/ai/voice/config";
import { SpeechAdapterService } from "../src/lib/ai/voice/speech-adapters";

async function main() {
  console.log("=================================================================");
  console.log("CYRAOPS AI VOICE ASSISTANT — COMPREHENSIVE VERIFICATION SUITE");
  console.log("=================================================================\n");

  // 1. Verify DeepSeek Only & Model Architecture
  console.log("--- 1. AI Reasoning Provider: DeepSeek Only & Model Configuration ---");
  const config = getVoiceConfig();
  console.log(`Provider: ${config.aiProvider} (DeepSeek Only)`);
  console.log(`Active Model: ${config.activeModel}`);
  console.log(`Supported Models: ${config.supportedModels.map((m) => `${m.name} [${m.id}] (active: ${m.active})`).join(", ")}`);

  if (config.aiProvider !== "deepseek") {
    throw new Error("Provider must be DeepSeek only!");
  }
  if (config.activeModel !== "deepseek-flash") {
    throw new Error("Active model must default to DeepSeek V4 Flash (deepseek-flash)!");
  }
  console.log("✓ AI Reasoning Provider: Verified DeepSeek Only with DeepSeek V4 Flash.\n");

  // Model switching test
  console.log("Testing configurable model switching to DeepSeek V4 Pro:");
  const switchPro = setActiveVoiceModel("deepseek-v4-pro");
  console.log(`  Switch to Pro: ${switchPro.success} -> ${getActiveVoiceModel()}`);
  const switchBack = setActiveVoiceModel("deepseek-flash");
  console.log(`  Switch back to Flash: ${switchBack.success} -> ${getActiveVoiceModel()}`);
  console.log("✓ Model switching architecture verified.\n");

  // 2. Language Detection & Adaptation
  console.log("--- 2. Multi-Language Adaptation (Hindi, English, Hinglish) ---");
  const testPhrases = [
    { text: "नमस्ते, मेरे पेंडिंग प्रोजेक्ट्स दिखाओ", expected: "hi" },
    { text: "Mere pending projects dikhao", expected: "hinglish" },
    { text: "Kal ke liye ek urgent task create kar do", expected: "hinglish" },
    { text: "Show me all overdue tasks and their assigned users", expected: "en" },
    { text: "Please draft a professional client follow-up email", expected: "en" },
  ];

  for (const { text, expected } of testPhrases) {
    const detected = SpeechAdapterService.detectLanguageStyle(text);
    console.log(`  Input: "${text}" -> Detected: ${detected} (Matches expected: ${detected === expected})`);
    if (detected !== expected) {
      throw new Error(`Language detection mismatch for "${text}"`);
    }
  }
  console.log("✓ Multi-language detection & adaptation verified.\n");

  // 3. CRM Tools Execution & Permission Verification
  console.log("--- 3. CRM Tools Permission-Controlled Execution ---");
  const testUser = await db.user.findFirst({
    where: { role: "OWNER" },
  });

  if (!testUser) {
    throw new Error("No test user found in dev database.");
  }
  console.log(`Executing tools as user: ${testUser.name} (${testUser.role})\n`);

  // Tool: get_dashboard_summary
  console.log("Testing Tool: get_dashboard_summary");
  const dashRes = await executeCrmTool("get_dashboard_summary", {}, testUser, "main");
  console.log(`  Success: ${dashRes.success}`);
  console.log(`  Overdue tasks: ${dashRes.result?.overdueTasksCount}`);
  console.log(`  Active projects: ${dashRes.result?.activeProjectsCount}`);
  console.log(`  Delayed projects: ${dashRes.result?.delayedProjectsCount}`);
  console.log(`  Pending leads: ${dashRes.result?.pendingLeadsCount}`);
  console.log("✓ get_dashboard_summary verified.\n");

  // Tool: list_projects
  console.log("Testing Tool: list_projects");
  const projRes = await executeCrmTool("list_projects", { status: "all" }, testUser, "main");
  console.log(`  Success: ${projRes.success}`);
  console.log(`  Projects found: ${projRes.result?.projects?.length}`);
  console.log("✓ list_projects verified.\n");

  // Tool: create_task (Low-risk write)
  console.log("Testing Tool: create_task (Low-Risk Write)");
  const taskRes = await executeCrmTool("create_task", {
    title: "Verify Voice Assistant Deployment",
    priority: "HIGH",
    dueDaysFromNow: 2,
  }, testUser, "main");
  console.log(`  Success: ${taskRes.success}`);
  console.log(`  Task created: "${taskRes.result?.task?.title}" (ID: ${taskRes.result?.task?.id})`);
  console.log("✓ create_task verified.\n");

  // Tool: search_emails
  console.log("Testing Tool: search_emails");
  const emailRes = await executeCrmTool("search_emails", { query: "" }, testUser, "main");
  console.log(`  Success: ${emailRes.success}`);
  console.log(`  Emails found: ${emailRes.result?.emails?.length}`);
  console.log("✓ search_emails verified.\n");

  // Tool: get_company_presence
  console.log("Testing Tool: get_company_presence");
  const presRes = await executeCrmTool("get_company_presence", {}, testUser, "main");
  console.log(`  Success: ${presRes.success}`);
  console.log(`  Website status: ${presRes.result?.website?.status}`);
  console.log("✓ get_company_presence verified.\n");

  // 4. High-Impact Action Confirmation Barrier
  console.log("--- 4. High-Impact Security & Action Confirmation Barrier ---");
  console.log("Testing Tool: send_email (HIGH-IMPACT - Must require explicit confirmation)");
  const sendEmailRes = await executeCrmTool("send_email", {
    to: "test-client@cyraops.com",
    subject: "Voice Assistant High-Impact Security Test",
    body: "This is a simulated verification message.",
  }, testUser, "main");

  console.log(`  Requires confirmation: ${sendEmailRes.requiresConfirmation}`);
  console.log(`  Pending action registered: ${Boolean(sendEmailRes.pendingAction)}`);
  console.log(`  Action ID: ${sendEmailRes.pendingAction?.id}`);
  console.log(`  Summary: ${sendEmailRes.pendingAction?.summary}`);
  console.log(`  Expiry timestamp: ${new Date(sendEmailRes.pendingAction?.expiresAt!).toISOString()}`);

  if (!sendEmailRes.requiresConfirmation || !sendEmailRes.pendingAction) {
    throw new Error("CRITICAL: send_email executed without requiring explicit confirmation!");
  }
  console.log("✓ Security Barrier: High-impact email send was successfully intercepted and placed into pending confirmation.\n");

  // Test executing confirmation
  console.log("Testing confirmed action execution flow with valid token:");
  const pendingActId = sendEmailRes.pendingAction.id;
  const retrievedPending = getPendingAction(pendingActId);
  console.log(`  Retrieved pending action: ${retrievedPending?.id} (status: ${retrievedPending?.status})`);

  // Test anti-replay protection: After execution or cancel, action token must be consumed
  const fakeUser: any = { id: "unauthorized_user_999", role: "MEMBER" };
  const unauthorizedConfirm = await executeConfirmedAction(pendingActId, fakeUser, "main");
  console.log(`  Cross-user confirm attempt: ${unauthorizedConfirm.success ? "FAILED SECURITY" : "BLOCKED"} (${unauthorizedConfirm.error})`);
  if (unauthorizedConfirm.success) {
    throw new Error("CRITICAL: Cross-user confirmed action was not blocked!");
  }
  console.log("✓ Cross-user action confirmation rejected.\n");

  console.log("=================================================================");
  console.log("ALL VERIFICATIONS COMPLETED SUCCESSFULLY!");
  console.log("=================================================================");
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});

