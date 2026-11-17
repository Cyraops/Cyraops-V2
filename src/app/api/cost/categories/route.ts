import { NextRequest, NextResponse } from "next/server";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { db } from "@/lib/db";
import { logCostAudit } from "@/lib/cost-service";

export async function GET(req: NextRequest) {
  try {
    const user = await userFromRequest(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const categories = await db.expenseCategory.findMany({
      where: { parentId: null },
      include: {
        children: {
          orderBy: { sortOrder: "asc" },
        },
        _count: {
          select: { expenses: true },
        },
      },
      orderBy: { sortOrder: "asc" },
    });

    return NextResponse.json({ categories });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
    }

    const user = await userFromRequest(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "OWNER" && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Only admins and owners can modify categories" }, { status: 403 });
    }

    const body = await req.json();
    const { id, name, slug, description, icon, color, parentId } = body;

    if (!name || typeof name !== "string") {
      return NextResponse.json({ error: "Category name is required" }, { status: 400 });
    }

    const generatedSlug = slug?.trim() || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

    let category;
    if (id) {
      category = await db.expenseCategory.update({
        where: { id },
        data: {
          name,
          slug: generatedSlug,
          description: description || null,
          icon: icon || "Tag",
          color: color || "#64748b",
          parentId: parentId || null,
        },
      });
      await logCostAudit({
        userId: user.id,
        userEmail: (user as any).email,
        action: "UPDATE",
        entityType: "CATEGORY",
        entityId: category.id,
        details: { name, slug: generatedSlug, parentId },
      });
    } else {
      category = await db.expenseCategory.create({
        data: {
          name,
          slug: generatedSlug,
          description: description || null,
          icon: icon || "Tag",
          color: color || "#64748b",
          parentId: parentId || null,
          isDefault: false,
        },
      });
      await logCostAudit({
        userId: user.id,
        userEmail: (user as any).email,
        action: "CREATE",
        entityType: "CATEGORY",
        entityId: category.id,
        details: { name, slug: generatedSlug, parentId },
      });
    }

    return NextResponse.json({ category });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
    }

    const user = await userFromRequest(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "OWNER" && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Only admins and owners can delete categories" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing category id" }, { status: 400 });

    const existing = await db.expenseCategory.findUnique({
      where: { id },
      include: {
        _count: { select: { expenses: true, subExpenses: true, children: true } },
      },
    });

    if (!existing) return NextResponse.json({ error: "Category not found" }, { status: 404 });
    if (existing.isDefault) {
      return NextResponse.json({ error: "Default system categories cannot be deleted" }, { status: 400 });
    }
    if (existing._count.expenses > 0 || existing._count.subExpenses > 0) {
      return NextResponse.json({ error: "Cannot delete category that contains recorded expenses" }, { status: 400 });
    }

    await db.expenseCategory.delete({ where: { id } });
    await logCostAudit({
      userId: user.id,
      userEmail: (user as any).email,
      action: "DELETE",
      entityType: "CATEGORY",
      entityId: id,
      details: { name: existing.name },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

