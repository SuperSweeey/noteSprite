import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensureTagHierarchy, normalizeTagPath, syncTagCounts } from "@/lib/tags-db";

export async function GET() {
  const userId = await getCurrentUserId();
  await syncTagCounts(userId);
  const tags = await prisma.tag.findMany({ where: { userId }, orderBy: { fullPath: "asc" } });
  return NextResponse.json({ tags });
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    const body = await req.json();
    const fullPath = normalizeTagPath(String(body.fullPath || body.name || ""));
    await ensureTagHierarchy(userId, fullPath);
    await syncTagCounts(userId);
    const tags = await prisma.tag.findMany({ where: { userId }, orderBy: { fullPath: "asc" } });
    return NextResponse.json({ tags }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "tag create failed" }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    const body = await req.json();
    const id = String(body.id || "").trim();
    const name = String(body.name || "").trim();
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    if (!name) return NextResponse.json({ error: "标签名称不能为空" }, { status: 400 });
    if (name.includes("/") || name.startsWith("#")) {
      return NextResponse.json({ error: "编辑名称时不能包含 # 或 /" }, { status: 400 });
    }

    const tag = await prisma.tag.findFirst({
      where: { id, userId },
      select: { id: true, fullPath: true },
    });
    if (!tag) return NextResponse.json({ error: "not found" }, { status: 404 });

    const parts = tag.fullPath.split("/");
    parts[parts.length - 1] = name;
    const nextFullPath = normalizeTagPath(parts.join("/"));

    const descendants = await prisma.tag.findMany({
      where: { userId, OR: [{ id }, { fullPath: { startsWith: `${tag.fullPath}/` } }] },
      select: { id: true, fullPath: true },
    });
    const descendantIds = descendants.map((item) => item.id);
    const nextPaths = descendants.map((item) => {
      const suffix = item.fullPath === tag.fullPath ? "" : item.fullPath.slice(tag.fullPath.length + 1);
      return suffix ? `${nextFullPath}/${suffix}` : nextFullPath;
    });
    const conflict = await prisma.tag.findFirst({
      where: { userId, fullPath: { in: nextPaths }, id: { notIn: descendantIds } },
      select: { fullPath: true },
    });
    if (conflict) {
      return NextResponse.json({ error: `标签已存在：#${conflict.fullPath}` }, { status: 409 });
    }

    for (const item of descendants) {
      const suffix = item.fullPath === tag.fullPath ? "" : item.fullPath.slice(tag.fullPath.length + 1);
      const fullPath = suffix ? `${nextFullPath}/${suffix}` : nextFullPath;
      const leafName = fullPath.split("/").at(-1) || name;
      await prisma.tag.update({
        where: { id: item.id },
        data: { fullPath, name: leafName },
      });
    }

    await syncTagCounts(userId);
    const tags = await prisma.tag.findMany({ where: { userId }, orderBy: { fullPath: "asc" } });
    return NextResponse.json({ ok: true, tags });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "tag update failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    const id = new URL(req.url).searchParams.get("id") || "";
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const tag = await prisma.tag.findFirst({ where: { id, userId }, select: { id: true, fullPath: true } });
    if (!tag) return NextResponse.json({ error: "not found" }, { status: 404 });

    const descendants = await prisma.tag.findMany({
      where: { userId, OR: [{ id }, { fullPath: { startsWith: `${tag.fullPath}/` } }] },
      select: { id: true },
    });
    const ids = descendants.map((item) => item.id);
    if (ids.length === 0) return NextResponse.json({ ok: true });

    await prisma.noteTag.deleteMany({ where: { tagId: { in: ids } } });
    await prisma.tag.deleteMany({ where: { id: { in: ids } } });
    await syncTagCounts(userId);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "tag delete failed" }, { status: 500 });
  }
}
