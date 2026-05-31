import { readFile } from "fs/promises";
import { resolve } from "path";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userId = await getCurrentUserId();
    const asset = await prisma.asset.findFirst({
      where: { id: params.id, userId },
      select: { storagePath: true, mimeType: true, fileName: true },
    });
    if (!asset) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }

    const root = resolve(process.cwd(), "python", "output", "uploads");
    const filePath = resolve(asset.storagePath);
    if (!filePath.startsWith(root)) {
      return NextResponse.json({ error: "Asset path is outside upload storage" }, { status: 403 });
    }

    const bytes = await readFile(filePath);
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": asset.mimeType || "application/octet-stream",
        "Content-Disposition": `inline; filename="${encodeURIComponent(asset.fileName)}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e: any) {
    console.error("GET /api/assets/[id]/file error:", e);
    return NextResponse.json({ error: e.message || "Asset read failed" }, { status: 500 });
  }
}
