import { db } from "../src/lib/db";
import { executeCrmTool } from "../src/lib/ai/voice/crm-tools";

async function runConversationWorkflow() {
  console.log("=================================================================");
  console.log("TESTING COMPLETE 5-STEP VOICE ASSISTANT CONVERSATION WORKFLOW");
  console.log("=================================================================\n");

  const owner = await db.user.findFirst({ where: { role: "OWNER" } });
  if (!owner) throw new Error("No owner user found in development database.");

  console.log(`Authenticated user: ${owner.name} (${owner.id})\n`);

  // Ensure a realistic delayed project exists in dev database for test fidelity
  let delayedProj = await db.project.findFirst({
    where: {
      name: "Enterprise Cloud Migration",
      archivedAt: null,
    },
  });

  if (!delayedProj) {
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000);
    delayedProj = await db.project.create({
      data: {
        name: "Enterprise Cloud Migration",
        description: "Migration of legacy on-prem services to AWS/Azure cloud infrastructure.",
        status: "PLANNING",
        priority: "HIGH",
        deadline: twoDaysAgo,
        ownerId: owner.id,
        members: { create: { userId: owner.id, role: "LEAD" } },
      },
    });
    console.log(`Created test delayed project: "${delayedProj.name}" (Deadline was 2 days ago: ${delayedProj.deadline?.toISOString()})`);
  } else {
    console.log(`Found existing delayed project: "${delayedProj.name}" (Deadline: ${delayedProj.deadline?.toISOString()})`);
  }

  // Ensure an unread email exists in dev database
  let unreadEmail = await db.emailMessage.findFirst({
    where: { isRead: false },
  });
  if (!unreadEmail) {
    const account = await db.emailAccount.findFirst();
    if (account) {
      unreadEmail = await db.emailMessage.create({
        data: {
          accountId: account.id,
          fromEmail: "client.sponsor@megacorp.com",
          toRecipients: JSON.stringify([account.email]),
          subject: "Urgent: Project Timeline and Deliverables Inquiry",
          bodyText: "Hi Tanveer, We need an update on the cloud migration schedule before our board meeting on Friday. Please advise on next steps.",
          snippet: "Hi Tanveer, We need an update on the cloud migration schedule before our board meeting...",
          isRead: false,
          receivedAt: new Date(),
        },
      });
      console.log(`Created sample unread email from "${unreadEmail.fromEmail}": "${unreadEmail.subject}"`);
    }
  }

  // -------------------------------------------------------------
  // STEP 1: Show pending projects
  // -------------------------------------------------------------
  console.log("\n--- STEP 1: Show pending projects ---");
  console.log("User: 'Show pending projects'");
  const step1 = await executeCrmTool("list_projects", { status: "all" }, owner, "main");
  console.log(`Assistant Tool Result: Found ${step1.result?.projects?.length} projects:`);
  for (const p of step1.result?.projects || []) {
    console.log(`  - [${p.status}] ${p.name} (Deadline: ${p.deadline ? new Date(p.deadline).toLocaleDateString() : "None"})`);
  }
  if (!step1.success || !step1.result?.projects?.length) {
    throw new Error("Step 1 failed: Could not list pending projects.");
  }
  console.log("✓ Step 1 verified.");

  // -------------------------------------------------------------
  // STEP 2: Identify a delayed project
  // -------------------------------------------------------------
  console.log("\n--- STEP 2: Identify a delayed project ---");
  console.log("User: 'Which project is delayed?'");
  const step2 = await executeCrmTool("list_projects", { delayedOnly: true }, owner, "main");
  console.log(`Assistant Tool Result: Found ${step2.result?.projects?.length} delayed projects:`);
  const delayedProjects = step2.result?.projects || [];
  for (const dp of delayedProjects) {
    console.log(`  - ${dp.name} (Deadline passed on: ${new Date(dp.deadline).toLocaleDateString()})`);
  }
  const targetProject = delayedProjects[0];
  if (!targetProject) {
    throw new Error("Step 2 failed: No delayed projects identified.");
  }
  console.log(`✓ Step 2 verified: Identified delayed project "${targetProject.name}" (ID: ${targetProject.id}).`);

  // -------------------------------------------------------------
  // STEP 3: Create an urgent task for that project for tomorrow
  // -------------------------------------------------------------
  console.log("\n--- STEP 3: Create an urgent task for that project for tomorrow ---");
  console.log(`User: 'Create an urgent task for that project for tomorrow: Finalize Database Replication Schema'`);
  const step3 = await executeCrmTool("create_task", {
    title: "Finalize Database Replication Schema",
    description: "Urgent catch-up milestone: complete PostgreSQL logical replication and failover schema.",
    priority: "URGENT",
    dueDaysFromNow: 1, // Tomorrow
    projectId: targetProject.id,
  }, owner, "main");

  console.log("Assistant Tool Result:", step3.result?.message);
  const createdTask = step3.result?.task;
  console.log(`  Created Task ID: ${createdTask?.id}`);
  console.log(`  Title: ${createdTask?.title}`);
  console.log(`  Priority: ${createdTask?.priority}`);
  console.log(`  Due Date: ${new Date(createdTask?.dueDate).toISOString()}`);
  console.log(`  Attached Project: ${createdTask?.project?.name} (ID: ${createdTask?.projectId})`);

  if (!step3.success || createdTask?.priority !== "URGENT" || createdTask?.projectId !== targetProject.id) {
    throw new Error("Step 3 failed: Task was not created with URGENT priority or attached to the delayed project.");
  }
  console.log("✓ Step 3 verified.");

  // -------------------------------------------------------------
  // STEP 4: Summarize unread emails
  // -------------------------------------------------------------
  console.log("\n--- STEP 4: Summarize unread emails ---");
  console.log("User: 'Summarize unread emails'");
  const step4 = await executeCrmTool("search_emails", { unreadOnly: true, limit: 5 }, owner, "main");
  console.log(`Assistant Tool Result: Found ${step4.result?.emails?.length} unread emails:`);
  for (const em of step4.result?.emails || []) {
    console.log(`  - From: ${em.fromEmail} | Subject: "${em.subject}" | Unread: ${!em.isRead}`);
    console.log(`    Snippet: ${em.snippet}`);
  }
  if (!step4.success || !step4.result?.emails?.length) {
    throw new Error("Step 4 failed: Could not retrieve unread emails.");
  }
  console.log("✓ Step 4 verified.");

  // -------------------------------------------------------------
  // STEP 5: Draft a client email without sending it
  // -------------------------------------------------------------
  console.log("\n--- STEP 5: Draft a client email without sending it ---");
  console.log("User: 'Draft an email to client.sponsor@megacorp.com regarding project catch-up timeline'");
  const step5 = await executeCrmTool("draft_email", {
    to: "client.sponsor@megacorp.com",
    subject: "Update: Cloud Migration Timeline & Tomorrow's Milestone",
    body: "Hi Sarah,\n\nWe have scheduled an urgent catch-up task for tomorrow to finalize the database replication schema. The complete milestone update will be sent by end of day tomorrow.\n\nBest regards,\nTanveer",
  }, owner, "main");

  console.log("Assistant Tool Result:", step5.result?.message);
  const draftId = step5.result?.draftId;
  console.log(`  Draft ID: ${draftId}`);

  if (!step5.success || !draftId) {
    throw new Error("Step 5 failed: Draft email was not created.");
  }
  console.log("✓ Step 5 verified.");

  // -------------------------------------------------------------
  // STEP 6: Verify every result in development database and CRM models
  // -------------------------------------------------------------
  console.log("\n--- STEP 6: Verifying all records in PostgreSQL development database ---");

  // Verify created task in database
  const dbTask = await db.task.findUnique({
    where: { id: createdTask.id },
    include: { project: true, creator: true },
  });
  console.log("Database Verification [Task]:");
  console.log(`  Task ID in DB: ${dbTask?.id}`);
  console.log(`  Title: ${dbTask?.title}`);
  console.log(`  Priority: ${dbTask?.priority}`);
  console.log(`  Project: ${dbTask?.project.name}`);
  console.log(`  Creator: ${dbTask?.creator.name}`);
  if (!dbTask || dbTask.priority !== "URGENT" || dbTask.projectId !== targetProject.id) {
    throw new Error("Database verification failed for created task!");
  }
  console.log("✓ Task record verified in company_os_dev.");

  // Verify draft email in database
  const dbDraft = await db.emailMessage.findUnique({
    where: { id: draftId },
    include: { folder: true },
  });
  console.log("Database Verification [Draft Email]:");
  console.log(`  Draft ID in DB: ${dbDraft?.id}`);
  console.log(`  Subject: ${dbDraft?.subject}`);
  console.log(`  To Recipients: ${dbDraft?.toRecipients}`);
  console.log(`  Folder: ${dbDraft?.folder?.name}`);
  console.log(`  isDraft: ${dbDraft?.isDraft}`);
  console.log(`  deliveryStatus: ${dbDraft?.deliveryStatus}`);
  if (!dbDraft || !dbDraft.isDraft || dbDraft.deliveryStatus !== "PENDING") {
    throw new Error("Database verification failed for draft email!");
  }
  console.log("✓ Draft email verified in company_os_dev (marked isDraft=true, deliveryStatus=PENDING, never sent via SMTP).");

  console.log("\n=================================================================");
  console.log("ALL 5 WORKFLOW STEPS VERIFIED END-TO-END WITH 100% SUCCESS!");
  console.log("=================================================================");
}

runConversationWorkflow().catch((e) => {
  console.error("Conversation test failed:", e);
  process.exit(1);
});

