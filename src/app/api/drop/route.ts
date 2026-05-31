import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { createFileDrop, createTextDrop, DropError } from "@/lib/drop";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (file instanceof File) {
        const result = await createFileDrop(userId, file);
        return NextResponse.json(result);
      }
      const text = String(form.get("text") || form.get("content") || "").trim();
      const result = await createTextDrop(userId, text);
      return NextResponse.json(result);
    }

    const body = await req.json().catch(() => ({}));
    const text = String(body.text || body.content || body.url || "").trim();
    const result = await createTextDrop(userId, text);
    return NextResponse.json(result);
  } catch (e: any) {
    console.error("POST /api/drop error:", e);
    if (e instanceof DropError) {
      return NextResponse.json({ error: e.message, details: e.details }, { status: e.status });
    }
    return NextResponse.json({ error: e.message || "丢万物入口处理失败。" }, { status: 500 });
  }
}
