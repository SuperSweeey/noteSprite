import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { createFileDrop, DropError } from "@/lib/drop";

export const runtime = "nodejs";

const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|webp|gif|bmp|avif)$/i;

export async function POST(req: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请选择一个音频或视频文件。" }, { status: 400 });
    }
    if ((file.type || "").startsWith("image/") || IMAGE_EXTENSIONS.test(file.name || "")) {
      return NextResponse.json({ error: "这个入口只处理音频或视频。图片请从丢万物入口上传。" }, { status: 400 });
    }
    const result = await createFileDrop(userId, file);
    return NextResponse.json({ note: result.note, message: result.message });
  } catch (e: any) {
    console.error("POST /api/transcribe/upload error:", e);
    if (e instanceof DropError) {
      return NextResponse.json({ error: e.message, details: e.details }, { status: e.status });
    }
    return NextResponse.json({ error: e.message || "上传转录启动失败。" }, { status: 500 });
  }
}
