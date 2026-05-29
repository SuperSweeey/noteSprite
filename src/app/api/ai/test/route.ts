import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { getAIConfig } from "@/lib/ai-config";

function keyTail(key: string) {
  return key ? key.slice(-4) : "";
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    const body = await req.json();
    const config = await getAIConfig(userId, "chat");

    const requestKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    const key = requestKey || config.apiKey;
    const keySource = requestKey ? "当前输入框" : "已保存配置或环境变量";
    const url = String(body.baseUrl || "").trim() || config.baseUrl;
    const selectedModel = String(body.model || "").trim() || config.model;

    if (!key) {
      return NextResponse.json({
        ok: false,
        keySource,
        keyTail: "",
        error: "没有可用的模型密钥。请在设置里重新填写，或检查 .env 里的 DEEPSEEK_API_KEY。",
      });
    }

    const resp = await fetch(`${url.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: selectedModel,
        messages: [{ role: "user", content: "你好，请回复 OK。" }],
        max_tokens: 16,
        temperature: 0,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return NextResponse.json({
        ok: false,
        keySource,
        keyTail: keyTail(key),
        error: `模型连接失败：HTTP ${resp.status}。${text.slice(0, 220)}`,
      });
    }

    return NextResponse.json({
      ok: true,
      keySource,
      keyTail: keyTail(key),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message });
  }
}
