import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const userId = await getCurrentUserId();
  const tags = await prisma.tag.findMany({ where: { userId }, orderBy: { fullPath: "asc" } });
  return NextResponse.json({ tags });
}

export async function DELETE(req: NextRequest) {
  const userId = await getCurrentUserId();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const tag = await prisma.tag.findFirst({ where: { id, userId } });
  if (!tag) return NextResponse.json({ error: "not found" }, { status: 404 });
  // Delete all note-tag associations then the tag itself
  await prisma.noteTag.deleteMany({ where: { tagId: id } });
  await prisma.tag.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
