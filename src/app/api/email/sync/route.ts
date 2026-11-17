import { NextRequest, NextResponse } from "next/server";
import { EmailService } from "@/lib/email/service";
import { sameOrigin, userFromRequest } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
    }

    const user = await userFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Strict Authorization: Corporate mailbox sync is restricted to OWNER and ADMIN
    if (user.role !== "OWNER" && user.role !== "ADMIN") {
      return NextResponse.json(
        { error: "Permission denied. Mailbox synchronization is restricted to administrators." },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const isExplicitFolder = typeof body.folderPath === "string";
    const explicitFolderPath = isExplicitFolder ? body.folderPath.trim() : null;

    if (isExplicitFolder) {
      if (!explicitFolderPath) {
        return NextResponse.json(
          { error: "Folder path cannot be empty." },
          { status: 400 }
        );
      }

      // Prevent path traversal, slash injection, null bytes, and control characters
      if (
        explicitFolderPath.includes("..") ||
        explicitFolderPath.includes("/") ||
        explicitFolderPath.includes("\\") ||
        /[\x00-\x1f\x7f]/.test(explicitFolderPath)
      ) {
        return NextResponse.json(
          { error: "Invalid folder path. Folder path contains illegal or path-traversal characters." },
          { status: 400 }
        );
      }
    }

    // Validate folderPath against actual configured mailbox folders
    const account = await EmailService.getOrCreateAccount();

    let targetFolderPath: string;

    if (isExplicitFolder) {
      const matchedFolder = account.folders.find(
        (f) =>
          f.rawPath.toLowerCase() === explicitFolderPath!.toLowerCase() ||
          f.name.toLowerCase() === explicitFolderPath!.toLowerCase()
      );

      if (!matchedFolder) {
        return NextResponse.json(
          { error: `Folder '${explicitFolderPath}' does not exist in configured mailbox folders.` },
          { status: 400 }
        );
      }
      targetFolderPath = matchedFolder.rawPath;
    } else {
      // Defaulting to INBOX when missing is permitted, but INBOX must exist in configured folders
      const defaultFolder = account.folders.find(
        (f) =>
          f.type === "INBOX" ||
          f.rawPath.toUpperCase() === "INBOX" ||
          f.name.toUpperCase() === "INBOX"
      );

      if (!defaultFolder) {
        return NextResponse.json(
          { error: "No INBOX folder configured in mailbox." },
          { status: 400 }
        );
      }
      targetFolderPath = defaultFolder.rawPath;
    }

    const result = await EmailService.syncMailbox({ folderPath: targetFolderPath });

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message || "Sync failed" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await userFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Strict Authorization: Mailbox connection diagnostics are restricted to OWNER and ADMIN
    if (user.role !== "OWNER" && user.role !== "ADMIN") {
      return NextResponse.json(
        { error: "Permission denied. Mailbox connection diagnostics are restricted to administrators." },
        { status: 403 }
      );
    }

    const result = await EmailService.testConnection();
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Connection check failed" }, { status: 500 });
  }
}
