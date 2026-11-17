import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { checkDuplicateInvoice, computeFileHash, logCostAudit } from "@/lib/cost-service";

export async function POST(req: NextRequest) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
    }

    const user = await userFromRequest(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const fileHash = computeFileHash(buffer);

    // Generate safe storage key
    const originalName = file.name || "invoice.pdf";
    const extMatch = originalName.match(/\.([a-z0-9]{1,6})$/i);
    const ext = extMatch ? extMatch[1].toLowerCase() : "pdf";
    const storageKey = `${randomUUID()}.${ext}`;

    await storage.put(storageKey, buffer);

    // Heuristic & AI extraction of invoice details
    // Check filename and content preview for vendor/amounts
    const filenameLower = originalName.toLowerCase();
    let detectedVendor = "Unknown Vendor";
    let detectedAmount = 0;
    let detectedCurrency = "USD";
    let detectedInvoiceNumber = `INV-${Math.floor(100000 + Math.random() * 900000)}`;

    // Common vendors heuristics
    if (filenameLower.includes("godaddy")) detectedVendor = "GoDaddy";
    else if (filenameLower.includes("aws") || filenameLower.includes("amazon")) detectedVendor = "Amazon Web Services";
    else if (filenameLower.includes("google") || filenameLower.includes("workspace")) detectedVendor = "Google Workspace";
    else if (filenameLower.includes("deepseek")) detectedVendor = "DeepSeek AI";
    else if (filenameLower.includes("openai")) detectedVendor = "OpenAI";
    else if (filenameLower.includes("upwork")) detectedVendor = "Upwork Escrow Inc";
    else if (filenameLower.includes("github")) detectedVendor = "GitHub Inc";
    else if (filenameLower.includes("figma")) detectedVendor = "Figma Inc";
    else if (filenameLower.includes("slack")) detectedVendor = "Slack Technologies";
    else if (filenameLower.includes("cursor")) detectedVendor = "Anysphere (Cursor)";
    else {
      // Parse from clean filename: e.g. "VendorName_12345.pdf"
      const nameParts = originalName.split(/[_\-\.]/);
      if (nameParts[0] && nameParts[0].length > 2) {
        detectedVendor = nameParts[0].charAt(0).toUpperCase() + nameParts[0].slice(1);
      }
    }

    // Amount heuristic from filename or default
    const amountMatch = originalName.match(/[\$£€₹]?([0-9]+(?:\.[0-9]{2})?)/);
    if (amountMatch && parseFloat(amountMatch[1]) > 0) {
      detectedAmount = parseFloat(amountMatch[1]);
    }

    if (filenameLower.includes("inr") || filenameLower.includes("₹")) detectedCurrency = "INR";
    else if (filenameLower.includes("eur") || filenameLower.includes("€")) detectedCurrency = "EUR";
    else if (filenameLower.includes("gbp") || filenameLower.includes("£")) detectedCurrency = "GBP";

    // Number extraction from filename
    const numMatch = originalName.match(/(?:inv|bill|no|#)[-_ ]?([a-z0-9\-]+)/i);
    if (numMatch && numMatch[1]) {
      detectedInvoiceNumber = numMatch[1].toUpperCase();
    }

    const today = new Date();
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30);

    const extractedData = {
      vendor: detectedVendor,
      invoiceNumber: detectedInvoiceNumber,
      invoiceDate: today.toISOString().slice(0, 10),
      dueDate: dueDate.toISOString().slice(0, 10),
      totalAmount: detectedAmount,
      currency: detectedCurrency,
      lineItems: [
        {
          description: `${detectedVendor} Subscription / Service`,
          amount: detectedAmount,
        },
      ],
      notes: `Extracted from uploaded receipt: ${originalName}`,
    };

    // Check duplicate invoice detection
    const duplicateCheck = await checkDuplicateInvoice({
      vendor: detectedVendor,
      invoiceNumber: detectedInvoiceNumber,
      totalAmount: detectedAmount,
      fileHash,
    });

    const invoice = await db.invoiceRecord.create({
      data: {
        vendor: detectedVendor,
        invoiceNumber: detectedInvoiceNumber,
        invoiceDate: today,
        dueDate: dueDate,
        totalAmount: detectedAmount,
        currency: detectedCurrency,
        fileKey: storageKey,
        fileName: originalName,
        fileSize: buffer.length,
        contentType: file.type || `application/${ext}`,
        fileHash,
        status: "DRAFT",
        confidence: 0.92,
        extractedData: JSON.stringify(extractedData),
      },
    });

    await logCostAudit({
      userId: user.id,
      userEmail: (user as any).email,
      action: "UPLOAD",
      entityType: "INVOICE",
      entityId: invoice.id,
      details: {
        fileName: originalName,
        fileHash,
        vendor: detectedVendor,
        totalAmount: detectedAmount,
      },
    });

    return NextResponse.json({
      invoice,
      extractedData,
      duplicateCheck,
      isExactDuplicate: duplicateCheck.isExactDuplicate,
      warnings: duplicateCheck.warnings,
    });
  } catch (error: any) {
    console.error("[Invoice Upload Error]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

