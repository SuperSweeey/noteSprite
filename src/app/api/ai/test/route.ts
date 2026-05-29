import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAIConfig } from "@/lib/ai-config";

export async function POST(req: NextRequest) {
  try {
    const { model, apiKey, baseUrl, providerId } = await req.json();

    let key = apiKey;
    let url = baseUrl;

    // If providerId is given, resolve real key + baseUrl from DB
    if (providerId && !key) {
      const userId = await getCurrentUserId();
      const user = await prisma.user.findUnique({ where: { id: userId } });
      let settings: any = {};
      try { settings = JSON.parse(user?.settings || "{}"); } catch {}
      const provider = settings.providers?.find((p: any) => p.id === providerId);
      if (provider) {
        key = provider.apiKey;
        url = url || provider.baseUrl;
      }
    }

    key = key || process.env.DEEPSEEK_API_KEY;
    if (!key) return NextResponse.json({ ok: false, error: "未配置密钥" });

    const resp = await fetch((url || process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1") + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: model || "deepseek-v4-flash", messages: [{ role: "user", content: "你好" }], max_tokens: 10 }),
    });
    if (!resp.ok) { const e = await resp.text(); return NextResponse.json({ ok: false, error: e.slice(0, 100) }); }
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }); }
}