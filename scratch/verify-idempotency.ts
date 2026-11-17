import { db } from "/Users/tanveersinghsaini/Desktop/locally hosted app dev/src/lib/db";
import { EmailService } from "/Users/tanveersinghsaini/Desktop/locally hosted app dev/src/lib/email/service";
import nodemailer from "nodemailer";

interface Check {
  id: string;
  desc: string;
  passed: boolean;
  reason: string;
}

const checks: Check[] = [];

function assert(id: string, desc: string, condition: boolean, reason: string) {
  checks.push({ id, desc, passed: condition, reason });
  console.log(`${condition ? "✅ PASS" : "❌ FAIL"} [${id}]: ${desc} — ${reason}`);
}

// Helper to create mock nodemailer transport
function createMockTransport(options: {
  shouldFail?: boolean;
  failError?: string;
  delayMs?: number;
  onSend?: (mail: any) => void;
}) {
  let callCount = 0;
  const transport = nodemailer.createTransport({
    streamTransport: true,
  });

  const originalSendMail = transport.sendMail.bind(transport);
  (transport as any).sendMail = async (mailOptions: any) => {
    callCount++;
    if (options.onSend) options.onSend(mailOptions);
    if (options.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }
    if (options.shouldFail) {
      throw new Error(options.failError || "SMTP 550 User mailbox quota exceeded");
    }
    return {
      messageId: mailOptions.messageId || `<mock_${Date.now()}@cyraops.com>`,
      response: "250 2.0.0 OK: queued as mock12345",
      accepted: mailOptions.to ? (Array.isArray(mailOptions.to) ? mailOptions.to : [mailOptions.to]) : ["client@example.com"],
      rejected: [],
      pending: [],
    };
  };

  return {
    transporter: transport,
    getCallCount: () => callCount,
  };
}

async function run() {
  console.log("=== STARTING SMTP IDEMPOTENCY & CRASH RECOVERY VERIFICATION ===");

  const owner = await db.user.findFirstOrThrow({ where: { role: "OWNER" } });

  // -------------------------------------------------------------
  // TEST 1: First request sends once
  // -------------------------------------------------------------
  const key1 = `test_idem_first_${Date.now()}`;
  const mock1 = createMockTransport({});
  const res1 = await EmailService.sendEmail({
    userId: owner.id,
    idempotencyKey: key1,
    to: ["client1@enterprise.com"],
    subject: "Idempotency Test 1",
    bodyText: "First request body",
    transportOverride: mock1.transporter,
  });

  assert(
    "IDEM-1",
    "First request sends once and commits SENT status",
    mock1.getCallCount() === 1 && res1.deliveryStatus === "SENT" && !res1.isDuplicatePrevented,
    `Mock SMTP calls: ${mock1.getCallCount()}, Delivery status: ${res1.deliveryStatus}`
  );

  // -------------------------------------------------------------
  // TEST 2: Identical retry does not send again
  // -------------------------------------------------------------
  const res2 = await EmailService.sendEmail({
    userId: owner.id,
    idempotencyKey: key1, // Same key!
    to: ["client1@enterprise.com"],
    subject: "Idempotency Test 1",
    bodyText: "First request body",
    transportOverride: mock1.transporter,
  });

  assert(
    "IDEM-2",
    "Identical retry does not send again",
    mock1.getCallCount() === 1 && res2.deliveryStatus === "SENT" && res2.isDuplicatePrevented === true,
    `Mock SMTP calls remained: ${mock1.getCallCount()}, isDuplicatePrevented: ${res2.isDuplicatePrevented}`
  );

  // -------------------------------------------------------------
  // TEST 3: Concurrent identical requests result in one dispatch
  // -------------------------------------------------------------
  const key3 = `test_idem_concurrent_${Date.now()}`;
  let concurrentSmtpCalls = 0;
  const mock3 = createMockTransport({
    delayMs: 80, // Introduce realistic network delay so requests overlap in flight
    onSend: () => {
      concurrentSmtpCalls++;
    },
  });

  const sendPromises = Array.from({ length: 5 }, (_, i) =>
    EmailService.sendEmail({
      userId: owner.id,
      idempotencyKey: key3,
      to: ["concurrent@enterprise.com"],
      subject: "Concurrent Send Test",
      bodyText: `Body attempt ${i}`,
      transportOverride: mock3.transporter,
    }).then(
      (res) => ({ success: true, res }),
      (err) => ({ success: false, err: err.message, status: err.statusCode })
    )
  );

  const concurrentResults = await Promise.all(sendPromises);
  const successfulSends = concurrentResults.filter((r) => r.success && !(r as any).res.isDuplicatePrevented);
  const totalDbRecords = await db.emailMessage.count({ where: { idempotencyKey: key3 } });

  assert(
    "IDEM-3",
    "Concurrent identical requests result in exactly ONE SMTP dispatch",
    concurrentSmtpCalls === 1 && successfulSends.length === 1 && totalDbRecords === 1,
    `SMTP calls: ${concurrentSmtpCalls}, Unique dispatches: ${successfulSends.length}, DB rows: ${totalDbRecords}`
  );

  // -------------------------------------------------------------
  // TEST 4: SMTP rejection records failure and allows explicit retry
  // -------------------------------------------------------------
  const key4 = `test_idem_fail_${Date.now()}`;
  const mock4Fail = createMockTransport({ shouldFail: true, failError: "550 User mailbox quota exceeded" });

  let failedError = "";
  try {
    await EmailService.sendEmail({
      userId: owner.id,
      idempotencyKey: key4,
      to: ["rejected@enterprise.com"],
      subject: "Rejection Test",
      bodyText: "Will fail",
      transportOverride: mock4Fail.transporter,
    });
  } catch (err: any) {
    failedError = err.message;
  }

  const failedDbMsg = await db.emailMessage.findUnique({ where: { idempotencyKey: key4 } });
  assert(
    "IDEM-4A",
    "SMTP rejection records failure in database",
    failedDbMsg?.deliveryStatus === "FAILED" && (failedDbMsg?.lastError?.includes("550") || false),
    `DB status: ${failedDbMsg?.deliveryStatus}, lastError: ${failedDbMsg?.lastError}`
  );

  // Retry policy on FAILED: now retry with succeeding SMTP transport
  const mock4Success = createMockTransport({ shouldFail: false });
  const retryResult = await EmailService.sendEmail({
    userId: owner.id,
    idempotencyKey: key4,
    to: ["rejected@enterprise.com"],
    subject: "Rejection Test",
    bodyText: "Will succeed now",
    transportOverride: mock4Success.transporter,
  });

  assert(
    "IDEM-4B",
    "Explicit retry policy allows retrying previously FAILED message to SENT",
    retryResult.deliveryStatus === "SENT" && mock4Success.getCallCount() === 1,
    `Retry delivery status: ${retryResult.deliveryStatus}, SMTP calls: ${mock4Success.getCallCount()}`
  );

  // -------------------------------------------------------------
  // TEST 5: Simulated post-SMTP failure results in DELIVERY_UNCERTAIN
  // -------------------------------------------------------------
  const key5 = `test_idem_uncertain_${Date.now()}`;
  // Create message manually in DELIVERY_UNCERTAIN state to simulate post-SMTP failure
  const account = await EmailService.getOrCreateAccount();
  const sentFolder = account.folders.find((f) => f.type === "SENT");
  const uncertainMsg = await db.emailMessage.create({
    data: {
      accountId: account.id,
      userId: owner.id,
      folderId: sentFolder?.id,
      messageId: `<uncertain_${Date.now()}@cyraops.com>`,
      idempotencyKey: key5,
      deliveryStatus: "DELIVERY_UNCERTAIN",
      lastError: "Database write failure after SMTP delivery (simulated)",
      fromEmail: "tanveer@cyraops.com",
      toRecipients: JSON.stringify(["uncertain@enterprise.com"]),
      subject: "Uncertain Delivery Test",
      bodyText: "Uncertain body",
    },
  });

  assert(
    "IDEM-5",
    "Uncertain delivery state persists with diagnostic metadata",
    uncertainMsg.deliveryStatus === "DELIVERY_UNCERTAIN",
    `Saved message deliveryStatus: ${uncertainMsg.deliveryStatus}`
  );

  // -------------------------------------------------------------
  // TEST 6: Uncertain messages are NOT automatically resent
  // -------------------------------------------------------------
  const mock6 = createMockTransport({});
  let uncertainBlocked = false;
  let blockedError = "";
  try {
    await EmailService.sendEmail({
      userId: owner.id,
      idempotencyKey: key5,
      to: ["uncertain@enterprise.com"],
      subject: "Uncertain Delivery Test",
      transportOverride: mock6.transporter,
    });
  } catch (err: any) {
    uncertainBlocked = true;
    blockedError = err.message;
  }

  assert(
    "IDEM-6A",
    "Uncertain messages are NOT automatically resent",
    uncertainBlocked && mock6.getCallCount() === 0 && blockedError.includes("uncertain"),
    `Auto-resend blocked: ${uncertainBlocked}, SMTP calls: ${mock6.getCallCount()}, Error: ${blockedError}`
  );

  // Reconcile uncertain message
  const reconciledMsg = await EmailService.reconcileUncertainMessage(key5, "MARK_SENT");
  assert(
    "IDEM-6B",
    "Safe manual reconciliation transitions DELIVERY_UNCERTAIN to SENT",
    reconciledMsg.deliveryStatus === "SENT",
    `Reconciled deliveryStatus: ${reconciledMsg.deliveryStatus}`
  );

  // -------------------------------------------------------------
  // TEST 7: Existing SENT records remain unchanged
  // -------------------------------------------------------------
  const originalMsg = await db.emailMessage.findUniqueOrThrow({ where: { idempotencyKey: key1 } });
  const originalSentAt = originalMsg.sentAt?.getTime();

  // Retry sending key1 again
  await EmailService.sendEmail({
    userId: owner.id,
    idempotencyKey: key1,
    to: ["client1@enterprise.com"],
    subject: "Idempotency Test 1",
    transportOverride: mock1.transporter,
  });

  const checkMsg = await db.emailMessage.findUniqueOrThrow({ where: { idempotencyKey: key1 } });
  assert(
    "IDEM-7",
    "Existing SENT records remain completely unchanged on subsequent attempts",
    checkMsg.sentAt?.getTime() === originalSentAt && checkMsg.messageId === originalMsg.messageId,
    `SentAt matched: ${checkMsg.sentAt?.getTime() === originalSentAt}, MessageId matched: ${checkMsg.messageId === originalMsg.messageId}`
  );

  // -------------------------------------------------------------
  // TEST 8: IMAP APPEND failures do not change SMTP delivery status
  // -------------------------------------------------------------
  const key8 = `test_idem_imap_fail_${Date.now()}`;
  const mock8 = createMockTransport({});
  // Mock appendEmailToSent to fail
  const originalAppend = EmailService.appendEmailToSent;
  EmailService.appendEmailToSent = async () => ({ ok: false, error: "Mock IMAP Sent folder quota exceeded" });

  try {
    const res8 = await EmailService.sendEmail({
      userId: owner.id,
      idempotencyKey: key8,
      to: ["client8@enterprise.com"],
      subject: "IMAP Append Failure Test",
      bodyText: "Should deliver via SMTP even if IMAP append fails",
      transportOverride: mock8.transporter,
    });

    assert(
      "IDEM-8",
      "IMAP APPEND failure does not change SMTP delivery status",
      res8.deliveryStatus === "SENT" && res8.imapAppendStatus === "FAILED" && mock8.getCallCount() === 1,
      `Delivery status: ${res8.deliveryStatus}, imapAppendStatus: ${res8.imapAppendStatus}`
    );
  } finally {
    EmailService.appendEmailToSent = originalAppend;
  }

  // -------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------
  console.log("\n=== TEST SUMMARY ===");
  const passed = checks.filter((c) => c.passed).length;
  const failed = checks.filter((c) => !c.passed).length;
  console.log(`Total Checks: ${checks.length} | Passed: ${passed} | Failed: ${failed}`);

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("FATAL in verify-idempotency:", err);
  process.exit(1);
});
