import { NextRequest, NextResponse } from "next/server";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  calculateNextDueDate,
  getRecurringPeriodKey,
  logCostAudit,
  COMPANY_BASE_CURRENCY,
} from "@/lib/cost-service";

export async function POST(req: NextRequest) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
    }

    const user = await userFromRequest(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "OWNER" && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Permission denied. Only admins or owners can record recurring payments." }, { status: 403 });
    }

    const body = await req.json();
    const { recurringId, paymentDate, dueDate, periodKey, notes } = body;

    if (!recurringId) {
      return NextResponse.json({ error: "Missing recurringId" }, { status: 400 });
    }

    const rec = await db.recurringExpense.findUnique({
      where: { id: recurringId },
      include: { category: true },
    });

    if (!rec) {
      return NextResponse.json({ error: "Recurring expense not found" }, { status: 404 });
    }

    // Determine canonical period key for idempotency
    const targetDueDate = dueDate ? new Date(dueDate) : rec.nextDueDate;
    const recurringPeriodKey = periodKey || getRecurringPeriodKey(targetDueDate, rec.billingCycle);

    // If a specific due date was requested that has already been advanced and recorded
    if (dueDate && new Date(dueDate).getTime() < rec.nextDueDate.getTime()) {
      const existing = await db.expense.findFirst({
        where: { recurringExpenseId: rec.id, recurringPeriodKey },
      });
      return NextResponse.json({
        expense: existing,
        recurring: rec,
        alreadyRecorded: true,
        message: `Payment for period ${recurringPeriodKey} was already recorded. Duplicate prevented.`,
      });
    }

    const payDate = paymentDate ? new Date(paymentDate) : new Date();

    // Atomic Database Transaction with Unique Constraint Idempotency Guard
    try {
      const result = await db.$transaction(async (tx) => {
        // 1. Check if an expense has already been recorded for this exact period
        const existingExpense = await tx.expense.findUnique({
          where: {
            recurringExpenseId_recurringPeriodKey: {
              recurringExpenseId: rec.id,
              recurringPeriodKey,
            },
          },
        });

        if (existingExpense) {
          // Idempotent return: already recorded for this period!
          return {
            expense: existingExpense,
            recurring: rec,
            alreadyRecorded: true,
            message: `Payment for period ${recurringPeriodKey} was already recorded on ${existingExpense.createdAt.toLocaleDateString()}. Duplicate prevented.`,
          };
        }

        // 2. Create the real Expense for this period
        const expense = await tx.expense.create({
          data: {
            title: `${rec.title} (${rec.billingCycle} - ${recurringPeriodKey})`,
            description: notes || `Recurring subscription payment for ${rec.title} [Period: ${recurringPeriodKey}]`,
            amount: rec.amount,
            currency: rec.currency,
            exchangeRate: rec.exchangeRate,
            exchangeRateDate: rec.exchangeRateDate,
            exchangeRateSource: rec.exchangeRateSource,
            amountBase: rec.amountBase,
            baseCurrency: rec.baseCurrency || COMPANY_BASE_CURRENCY,
            categoryId: rec.categoryId,
            paymentMethod: rec.paymentMethod,
            paymentStatus: "PAID",
            paymentDate: payDate,
            vendor: rec.vendor,
            isRecurring: true,
            recurringExpenseId: rec.id,
            recurringPeriodKey,
            userId: user.id,
          },
        });

        // 3. Atomically advance next due date
        const nextDue = calculateNextDueDate(rec.nextDueDate, rec.billingCycle);
        const updatedRec = await tx.recurringExpense.update({
          where: { id: recurringId },
          data: {
            nextDueDate: nextDue,
          },
        });

        return {
          expense,
          recurring: updatedRec,
          alreadyRecorded: false,
          message: `Payment of ${rec.currency} ${rec.amount} recorded for period ${recurringPeriodKey}. Next due date advanced to ${nextDue.toLocaleDateString()}.`,
        };
      });

      if (!result.alreadyRecorded) {
        await logCostAudit({
          userId: user.id,
          userEmail: (user as any).email,
          action: "CREATE",
          entityType: "EXPENSE",
          entityId: result.expense.id,
          details: {
            fromRecurring: recurringId,
            periodKey: recurringPeriodKey,
            amount: result.expense.amount,
            advancedNextDueDate: result.recurring.nextDueDate.toISOString(),
          },
        });
      }

      return NextResponse.json(result);
    } catch (txError: any) {
      // Prisma P2002 indicates a concurrent race condition was stopped by the database constraint
      if (txError.code === "P2002") {
        const existing = await db.expense.findUnique({
          where: {
            recurringExpenseId_recurringPeriodKey: {
              recurringExpenseId: rec.id,
              recurringPeriodKey,
            },
          },
        });
        const currentRec = await db.recurringExpense.findUnique({ where: { id: recurringId } });
        return NextResponse.json({
          expense: existing,
          recurring: currentRec,
          alreadyRecorded: true,
          message: `Concurrent request intercepted. Payment for period ${recurringPeriodKey} was already recorded.`,
        });
      }
      throw txError;
    }
  } catch (error: any) {
    console.error("[Record Recurring Payment Error]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
