import test from "node:test";
import assert from "node:assert/strict";
import {
  convertToBaseCurrency,
  getExchangeRate,
  computeFileHash,
  calculateNextDueDate,
  getRecurringPeriodKey,
  ensureDefaultCategories,
  checkDuplicateInvoice,
  COMPANY_BASE_CURRENCY,
} from "./cost-service";
import { db } from "./db";

test("Cost Service - Base Currency is INR and Exchange Rate Calculations", () => {
  assert.equal(COMPANY_BASE_CURRENCY, "INR", "Default reporting currency must be INR");

  // 1. INR to INR is 1.0 (baseline)
  const inrResult = convertToBaseCurrency(10000, "INR");
  assert.equal(inrResult.rate, 1.0);
  assert.equal(inrResult.amountBase, 10000);
  assert.equal(inrResult.source, "SYSTEM_BASELINE");

  // 2. USD to INR (1 USD = 86.5 INR benchmark)
  const usdResult = convertToBaseCurrency(100, "USD");
  assert.equal(usdResult.rate, 86.5);
  assert.equal(usdResult.amountBase, 8650);
  assert.equal(usdResult.source, "SYSTEM_BASELINE");

  // 3. EUR to INR (1 EUR = 93.5 INR benchmark)
  const eurResult = convertToBaseCurrency(100, "EUR");
  assert.equal(eurResult.rate, 93.5);
  assert.equal(eurResult.amountBase, 9350);

  // 4. GBP to INR (1 GBP = 110.0 INR benchmark)
  const gbpResult = convertToBaseCurrency(100, "GBP");
  assert.equal(gbpResult.rate, 110.0);
  assert.equal(gbpResult.amountBase, 11000);

  // 5. Custom rate override (User manual bank statement rate)
  const customRate = 87.25;
  const customResult = convertToBaseCurrency(100, "USD", customRate);
  assert.equal(customResult.rate, 87.25);
  assert.equal(customResult.amountBase, 8725);
  assert.equal(customResult.source, "MANUAL_OVERRIDE");
});

test("Cost Service - SHA-256 File Hashing", () => {
  const bufA = Buffer.from("Invoice #1234 from AWS for $150.00");
  const bufB = Buffer.from("Invoice #1234 from AWS for $150.00");
  const bufC = Buffer.from("Invoice #5678 from GoDaddy for $25.00");

  const hashA = computeFileHash(bufA);
  const hashB = computeFileHash(bufB);
  const hashC = computeFileHash(bufC);

  assert.equal(hashA.length, 64);
  assert.equal(hashA, hashB, "Identical buffers must produce identical hashes");
  assert.notEqual(hashA, hashC, "Different contents must produce different hashes");
});

test("Cost Service - Recurring Schedules & Canonical Period Keys", () => {
  const baseDate = new Date("2026-11-15T12:00:00Z");

  // Canonical period keys
  assert.equal(getRecurringPeriodKey(baseDate, "MONTHLY"), "2026-11");
  assert.equal(getRecurringPeriodKey(baseDate, "QUARTERLY"), "2026-Q4");
  assert.equal(getRecurringPeriodKey(baseDate, "ANNUALLY"), "2026");

  // Due date advancement
  const weekly = calculateNextDueDate(baseDate, "WEEKLY");
  assert.equal(weekly.toISOString().slice(0, 10), "2026-11-22");

  const monthly = calculateNextDueDate(baseDate, "MONTHLY");
  assert.equal(monthly.toISOString().slice(0, 10), "2026-12-15");

  const quarterly = calculateNextDueDate(baseDate, "QUARTERLY");
  assert.equal(quarterly.toISOString().slice(0, 10), "2027-02-15");

  const annually = calculateNextDueDate(baseDate, "ANNUALLY");
  assert.equal(annually.toISOString().slice(0, 10), "2027-11-15");
});

test("Cost Service - Accounting Classification Separation (Equity vs Debt Liabilities)", async () => {
  const adminUser = await db.user.findFirst({ where: { role: "OWNER" } });
  if (!adminUser) return;

  const testStamp = Date.now();
  // 1. Contributed Equity Capital
  const equityInv = await db.investment.create({
    data: {
      title: `Founder Equity Injection ${testStamp}`,
      investorName: "Founder Test",
      type: "FOUNDER_CAPITAL",
      amount: 100000,
      currency: "INR",
      amountBase: 100000,
      userId: adminUser.id,
    },
  });

  // 2. Loan (Liability - NOT Equity!)
  const loanInv = await db.investment.create({
    data: {
      title: `Bank Business Loan ${testStamp}`,
      investorName: "HDFC Bank",
      type: "LOAN",
      amount: 50000,
      currency: "INR",
      amountBase: 50000,
      userId: adminUser.id,
    },
  });

  try {
    const all = await db.investment.findMany({
      where: { id: { in: [equityInv.id, loanInv.id] } },
    });

    const equityTotal = all
      .filter((i) => i.type === "FOUNDER_CAPITAL" || i.type === "ANGEL_INVESTMENT")
      .reduce((s, i) => s + i.amountBase, 0);

    const loanTotal = all
      .filter((i) => i.type === "LOAN")
      .reduce((s, i) => s + i.amountBase, 0);

    assert.equal(equityTotal, 100000, "Equity capital must strictly exclude loans");
    assert.equal(loanTotal, 50000, "Loans must be segregated as debt liabilities");
  } finally {
    await db.investment.deleteMany({ where: { id: { in: [equityInv.id, loanInv.id] } } });
  }
});

test("Cost Service - Recurring Payment Concurrency & Idempotency", async () => {
  const adminUser = await db.user.findFirst({ where: { role: "OWNER" } });
  if (!adminUser) return;

  const cat = await db.expenseCategory.findFirst({ where: { parentId: null } });
  if (!cat) return;

  const testStamp = Date.now();
  const rec = await db.recurringExpense.create({
    data: {
      title: `Test Subscription ${testStamp}`,
      vendor: `Vendor ${testStamp}`,
      amount: 2500,
      currency: "INR",
      amountBase: 2500,
      categoryId: cat.id,
      billingCycle: "MONTHLY",
      nextDueDate: new Date("2026-11-01T00:00:00Z"),
      userId: adminUser.id,
    },
  });

  const periodKey = "2026-11";

  try {
    // Simulate first payment creation
    const exp1 = await db.expense.create({
      data: {
        title: `${rec.title} (MONTHLY - ${periodKey})`,
        amount: rec.amount,
        currency: "INR",
        amountBase: rec.amountBase,
        categoryId: rec.categoryId,
        paymentStatus: "PAID",
        vendor: rec.vendor,
        isRecurring: true,
        recurringExpenseId: rec.id,
        recurringPeriodKey: periodKey,
        userId: adminUser.id,
      },
    });
    assert.ok(exp1.id);

    // Simulate concurrent double-click or retry with identical recurringPeriodKey
    let caughtDuplicate = false;
    try {
      await db.expense.create({
        data: {
          title: `${rec.title} (MONTHLY - ${periodKey})`,
          amount: rec.amount,
          currency: "INR",
          amountBase: rec.amountBase,
          categoryId: rec.categoryId,
          paymentStatus: "PAID",
          vendor: rec.vendor,
          isRecurring: true,
          recurringExpenseId: rec.id,
          recurringPeriodKey: periodKey,
          userId: adminUser.id,
        },
      });
    } catch (err: any) {
      if (err.code === "P2002") {
        caughtDuplicate = true;
      }
    }

    assert.equal(caughtDuplicate, true, "Database unique constraint must intercept concurrent duplicate period payments");
  } finally {
    await db.expense.deleteMany({ where: { recurringExpenseId: rec.id } });
    await db.recurringExpense.delete({ where: { id: rec.id } });
  }
});

test("Cost Service - Invoice Duplication Integrity (Different Vendors & Exact File Match)", async () => {
  const dummyHash = "test-hash-" + Date.now();
  const vendorA = "VendorA_" + Date.now();
  const vendorB = "VendorB_" + Date.now();
  const sharedInvoiceNum = "INV-SHARED-101";

  // Vendor A creates invoice INV-SHARED-101
  const invA = await db.invoiceRecord.create({
    data: {
      vendor: vendorA,
      invoiceNumber: sharedInvoiceNum,
      totalAmount: 500,
      currency: "INR",
      fileKey: "dummy-key-a.pdf",
      fileName: "invoice_a.pdf",
      fileHash: dummyHash,
      status: "DRAFT",
    },
  });

  try {
    // 1. Same vendor + same invoice number -> DUPLICATE
    const dupCheck1 = await checkDuplicateInvoice({
      vendor: vendorA,
      invoiceNumber: sharedInvoiceNum,
      totalAmount: 500,
    });
    assert.equal(dupCheck1.isExactDuplicate, true, "Same vendor + invoice number must flag duplicate");

    // 2. Different vendor + same invoice number -> CLEAN PASS (NOT duplicate)
    const dupCheck2 = await checkDuplicateInvoice({
      vendor: vendorB,
      invoiceNumber: sharedInvoiceNum,
      totalAmount: 500,
      fileHash: "different-hash-" + Date.now(),
    });
    assert.equal(dupCheck2.isExactDuplicate, false, "Different vendors using the same invoice number must not be flagged duplicate");

    // 3. Exact file hash match -> DUPLICATE
    const dupCheck3 = await checkDuplicateInvoice({
      vendor: "Vendor C",
      invoiceNumber: "INV-OTHER",
      totalAmount: 100,
      fileHash: dummyHash,
    });
    assert.equal(dupCheck3.isExactDuplicate, true, "Exact file hash match must flag duplicate");
  } finally {
    await db.invoiceRecord.delete({ where: { id: invA.id } }).catch(() => {});
  }
});
