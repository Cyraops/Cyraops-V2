import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { userFromRequest } from "@/lib/auth";
import { EmailService } from "@/lib/email/service";
import { emailMessageVisibilityWhere } from "@/lib/email/access";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await userFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (user.disabledAt) {
      return NextResponse.json({ error: "User is disabled" }, { status: 403 });
    }

    const { id } = await params;
    const account = await EmailService.getOrCreateAccount();

    const message = await db.emailMessage.findFirst({
      where: {
        id,
        accountId: account.id,
        ...emailMessageVisibilityWhere(user),
      },
      include: {
        folder: true,
        attachments: {
          select: {
            id: true,
            filename: true,
            contentType: true,
            sizeBytes: true,
          },
        },
      },
    });

    if (!message) {
      return NextResponse.json({ error: "Email not found" }, { status: 404 });
    }

    // Auto mark as read
    if (!message.isRead) {
      await db.emailMessage.update({
        where: { id: message.id },
        data: { isRead: true },
      });
      message.isRead = true;
      // Trigger remote flag sync if UID exists
      if (message.uid) {
        void EmailService.syncFlagsToRemote({ messageIds: [message.id], action: "markRead" });
      }
    }

    // Look up sender against CRM Contacts, Leads, Companies
    let crmMatch: { type: "contact" | "lead" | "company"; name: string; id: string; details?: string } | null = null;
    const senderEmail = message.fromEmail.toLowerCase();
    const domain = senderEmail.split("@")[1];

    const contact = await db.contact.findFirst({
      where: { email: { equals: senderEmail, mode: "insensitive" } },
      include: { company: true },
    });

    if (contact) {
      crmMatch = {
        type: "contact",
        id: contact.id,
        name: `${contact.firstName} ${contact.lastName}`.trim(),
        details: contact.company?.name ? `${contact.title || "Contact"} at ${contact.company.name}` : contact.title || undefined,
      };
    } else {
      const lead = await db.lead.findFirst({
        where: { email: { equals: senderEmail, mode: "insensitive" } },
      });
      if (lead) {
        crmMatch = {
          type: "lead",
          id: lead.id,
          name: lead.title,
          details: lead.companyName ? `Lead at ${lead.companyName}` : `Lead (${lead.status})`,
        };
      } else if (domain) {
        const company = await db.company.findFirst({
          where: { domain: { contains: domain, mode: "insensitive" } },
        });
        if (company) {
          crmMatch = {
            type: "company",
            id: company.id,
            name: company.name,
            details: company.industry || "Company record",
          };
        }
      }
    }

    return NextResponse.json({
      message,
      crmMatch,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load email" }, { status: 500 });
  }
}
