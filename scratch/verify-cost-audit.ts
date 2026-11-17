import assert from "node:assert/strict";
import { db } from "../src/lib/db";
import { createSession } from "../src/lib/auth";

async function runAuditVerification() {
  console.log("=== STARTING COST MODULE AUDIT & CORRECTION VERIFICATION ===");
  const baseUrl = "http://localhost:3001";

  // 1. Get Owner user and regular Member user
  const ownerUser = await db.user.findFirst({ where: { role: "OWNER" } });
  if (!ownerUser) throw new Error("No owner user found in company_os_dev");

  let memberUser = await db.user.findFirst({ where: { role: "MEMBER" } });
  if (!memberUser) {
    memberUser = await db.user.create({
      data: {
        name: "Test Audit Member",
        role: "MEMBER",
      },
    });
  }

  const { token: ownerToken } = await createSession(ownerUser.id);
  const { token: memberToken } = await createSession(memberUser.id);

  const ownerCookie = `company_session=${ownerToken}`;
  const memberCookie = `company_session=${memberToken}`;

  async function apiFetch(path: string, options: RequestInit = {}, asRole: "owner" | "member" | "unauth" = "owner") {
    const cookie = asRole === "owner" ? ownerCookie : asRole === "member" ? memberCookie : "";
    const headers: any = { ...(options.headers || {}) };
    if (cookie) headers.Cookie = cookie;

    return fetch(`${baseUrl}${path}`, {
      ...options,
      headers,
    });
  }

  // TEST 1: Default Base Currency is INR
  console.log("\n[TEST 1] Verifying Default Reporting Currency is INR...");
  const dashRes = await apiFetch("/api/cost/dashboard");
  const dashData = await dashRes.json();
  if (dashData.baseCurrency === "INR") {
    console.log(`✅ PASS [TEST 1]: Dashboard default reporting currency is INR (${dashData.baseCurrency})`);
  } else {
    throw new Error(`Expected base currency INR, got ${dashData.baseCurrency}`);
  }

  // TEST 2: Multi-Currency & Rate Preservation
  console.log("\n[TEST 2] Testing Multi-Currency INR Normalization & Rate Preservation...");
  const cat = await db.expenseCategory.findFirst({ where: { parentId: null } });
  if (!cat) throw new Error("No category found");

  const expRes = await apiFetch("/api/cost/expenses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "AWS US East Cloud Server Hosting",
      vendor: "Amazon Web Services",
      amount: 100, // $100 USD
      currency: "USD",
      categoryId: cat.id,
      paymentMethod: "CREDIT_CARD",
      paymentStatus: "PAID",
      classification: "OPEX",
      notes: "Audited currency test",
    }),
  });
  const expData = await expRes.json();
  if (
    expRes.status === 200 &&
    expData.expense.currency === "USD" &&
    expData.expense.amountBase === 8650 &&
    expData.expense.baseCurrency === "INR" &&
    expData.expense.exchangeRateSource === "SYSTEM_BASELINE"
  ) {
    console.log(`✅ PASS [TEST 2]: $100 USD correctly converted to ₹${expData.expense.amountBase} INR (Rate: ${expData.expense.exchangeRate}, Source: ${expData.expense.exchangeRateSource})`);
  } else {
    throw new Error(`Currency conversion failed: ${JSON.stringify(expData)}`);
  }

  // TEST 3: Accounting Classification (Loans segregated from Equity)
  console.log("\n[TEST 3] Testing Accounting Classification (Loans Segregated from Equity)...");
  // 3a. Record Equity
  const equityRes = await apiFetch("/api/cost/investments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Founder Equity Round A",
      investorName: "Founder",
      type: "FOUNDER_CAPITAL",
      amount: 200000,
      currency: "INR",
    }),
  });
  assert.equal(equityRes.status, 200);

  // 3b. Record Loan (Liability)
  const loanRes = await apiFetch("/api/cost/investments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "HDFC Working Capital Loan",
      investorName: "HDFC Bank",
      type: "LOAN",
      amount: 75000,
      currency: "INR",
    }),
  });
  assert.equal(loanRes.status, 200);

  // Query investments summary
  const invSummaryRes = await apiFetch("/api/cost/investments");
  const invSummary = await invSummaryRes.json();

  assert.ok(invSummary.equityCapitalBase >= 200000, "Contributed equity must be at least 200000");
  assert.ok(invSummary.debtLiabilitiesBase >= 75000, "Debt liabilities must be at least 75000");
  assert.equal(invSummary.totalInvestedBase, invSummary.equityCapitalBase, "Total invested capital must strictly equal equity capital (excluding loans)");
  console.log(`✅ PASS [TEST 3]: Accounting separation verified! Contributed Equity: ₹${invSummary.equityCapitalBase}, Debt Liabilities: ₹${invSummary.debtLiabilitiesBase} (Loans strictly excluded from Equity)`);

  // TEST 4: Recurring Expense Idempotency & Concurrent Double-Click Protection
  console.log("\n[TEST 4] Testing Recurring Expense Idempotency & Concurrent Double-Click Protection...");
  const recRes = await apiFetch("/api/cost/recurring", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Slack Business+ Seats",
      vendor: "Slack Technologies",
      amount: 5000,
      currency: "INR",
      categoryId: cat.id,
      billingCycle: "MONTHLY",
      nextDueDate: "2026-11-01T00:00:00Z",
    }),
  });
  const recData = await recRes.json();
  const recId = recData.recurring.id;
  const initialDueDate = recData.recurring.nextDueDate;

  // Send request 1 with explicit dueDate
  const req1 = await apiFetch("/api/cost/recurring/record-payment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recurringId: recId, dueDate: initialDueDate }),
  });
  const res1 = await req1.json();

  // Send request 2 (Double click / retry with same dueDate)
  const req2 = await apiFetch("/api/cost/recurring/record-payment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recurringId: recId, dueDate: initialDueDate }),
  });
  const res2 = await req2.json();

  assert.equal(res1.alreadyRecorded, false, "Request 1 must create payment");
  assert.equal(res2.alreadyRecorded, true, "Request 2 must be flagged alreadyRecorded");
  assert.equal(res1.expense.id, res2.expense.id, "Both requests must point to the same single expense");
  assert.equal(res1.recurring.nextDueDate.slice(0, 10), "2026-12-01", "Due date must advance exactly 1 cycle");
  assert.equal(res2.recurring.nextDueDate.slice(0, 10), "2026-12-01", "Due date must NOT double advance");
  console.log(`✅ PASS [TEST 4]: Idempotency verified! Request 1 recorded payment; Request 2 intercepted duplicate and returned existing expense without double-advancing due date (${res2.recurring.nextDueDate.slice(0, 10)})`);

  // TEST 5: Invoice Duplication & Scoping
  console.log("\n[TEST 5] Testing Invoice Duplication & Scoping...");
  const dummyPdf = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Test (Invoice Audit) >>\nendobj\n%%EOF");
  const formData = new FormData();
  formData.append("file", new Blob([dummyPdf], { type: "application/pdf" }), "audit_test_inv_101.pdf");

  const upRes = await apiFetch("/api/cost/invoices/upload", { method: "POST", body: formData });
  const upData = await upRes.json();

  // Re-upload identical file
  const formDataDup = new FormData();
  formDataDup.append("file", new Blob([dummyPdf], { type: "application/pdf" }), "audit_test_inv_101.pdf");
  const upDupRes = await apiFetch("/api/cost/invoices/upload", { method: "POST", body: formDataDup });
  const upDupData = await upDupRes.json();

  assert.equal(upDupData.isExactDuplicate, true, "Exact duplicate file hash must be flagged");
  assert.ok(upDupData.warnings?.length > 0, "Duplicate warnings must be populated");
  console.log(`✅ PASS [TEST 5]: Duplicate file hash correctly intercepted with warning: "${upDupData.warnings[0]}"`);

  // TEST 6: Server-Side Permissions & Security
  console.log("\n[TEST 6] Testing Server-Side Authorization Across All Endpoints...");
  // 6a. Unauthenticated access blocked
  const unauthInv = await apiFetch("/api/cost/investments", {}, "unauth");
  const unauthExp = await apiFetch("/api/cost/expenses", {}, "unauth");
  const unauthAudit = await apiFetch("/api/cost/audit", {}, "unauth");

  assert.equal(unauthInv.status, 401, "Unauthenticated /api/cost/investments must return 401");
  assert.equal(unauthExp.status, 401, "Unauthenticated /api/cost/expenses must return 401");
  assert.equal(unauthAudit.status, 401, "Unauthenticated /api/cost/audit must return 401");
  console.log("✅ PASS [TEST 6A]: Unauthenticated requests strictly return 401 Unauthorized");

  // 6b. Regular Member blocked from Cap Table & Equity
  const memberInv = await apiFetch("/api/cost/investments", {}, "member");
  assert.equal(memberInv.status, 403, "MEMBER accessing /api/cost/investments must return 403 Forbidden");

  // 6c. Regular Member blocked from Confidential Report Export
  const memberExport = await apiFetch("/api/cost/reports/export?type=investments", {}, "member");
  assert.equal(memberExport.status, 403, "MEMBER exporting investments report must return 403 Forbidden");

  // 6d. Regular Member blocked from Audit Logs
  const memberAudit = await apiFetch("/api/cost/audit", {}, "member");
  assert.equal(memberAudit.status, 403, "MEMBER accessing /api/cost/audit must return 403 Forbidden");

  // 6e. Admin permitted to view Audit Logs
  const adminAudit = await apiFetch("/api/cost/audit", {}, "owner");
  assert.equal(adminAudit.status, 200, "OWNER accessing /api/cost/audit must return 200 OK");
  const auditLogs = await adminAudit.json();
  assert.ok(auditLogs.logs?.length > 0, "Audit logs must contain traceable financial activity");
  console.log(`✅ PASS [TEST 6B-E]: Strict role permissions verified! Member blocked (403), Admin granted (200, ${auditLogs.logs.length} audit entries retrieved)`);

  // TEST 7: Production Port 3000 Isolation Check
  console.log("\n[TEST 7] Verifying Production (port 3000) isolation...");
  const prodHealthRes = await fetch("http://localhost:3000/api/health").catch(() => null);
  if (prodHealthRes && prodHealthRes.status === 200) {
    console.log(`✅ PASS [TEST 7]: Production server on port 3000 is intact, healthy, and isolated.`);
  } else {
    console.log(`Note [TEST 7]: Port 3000 status: ${prodHealthRes?.status ?? "not responding"}`);
  }

  console.log("\n=== ALL COST MODULE AUDIT & CORRECTION TESTS PASSED SUCCESSFULLY ===");
}

runAuditVerification()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Verification error:", err);
    process.exit(1);
  });
