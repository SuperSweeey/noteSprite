import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UserSettings, Provider, DEFAULTS, TranscriptionSettings } from "@/lib/ai-config";

export async function GET() {
  try {
    const userId = await getCurrentUserId();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    let settings: UserSettings;
    try { settings = JSON.parse(user?.settings || "{}"); } catch { settings = DEFAULTS; }
    const resolved = resolve(settings);

    // Mask API keys for display
    const masked = {
      ...resolved,
      providers: resolved.providers.map((p) => ({
        ...p,
        apiKey: p.apiKey ? "••••" + p.apiKey.slice(-4) : "",
      })),
      transcription: {
        ...resolved.transcription,
        dashscopeApiKey: resolved.transcription.dashscopeApiKey ? "••••" + resolved.transcription.dashscopeApiKey.slice(-4) : "",
        ossAccessKeySecret: resolved.transcription.ossAccessKeySecret ? "••••" + resolved.transcription.ossAccessKeySecret.slice(-4) : "",
      },
    };
    return NextResponse.json(masked);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    const body = await req.json();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    let existing: UserSettings;
    try { existing = JSON.parse(user?.settings || "{}"); } catch { existing = DEFAULTS; }

    const updated: UserSettings = {
      providers: existing.providers || DEFAULTS.providers,
      assignments: { ...DEFAULTS.assignments, ...existing.assignments },
      prompts: { ...existing.prompts },
      transcription: { ...DEFAULTS.transcription, ...existing.transcription },
    };

    if (body.providers) {
      updated.providers = body.providers.map((p: any) => ({
        ...p,
        apiKey: (p.apiKey && !p.apiKey.startsWith("••••")) ? p.apiKey : (existing.providers?.find((ep: Provider) => ep.id === p.id)?.apiKey || ""),
      }));
    }
    if (body.assignments) {
      updated.assignments = { ...updated.assignments, ...body.assignments };
    }
    if (body.prompts) {
      updated.prompts = { ...updated.prompts, ...body.prompts };
    }
    if (body.transcription) {
      const t = body.transcription;
      updated.transcription = {
        cookies: t.cookies ?? existing.transcription?.cookies ?? "",
        dashscopeApiKey: (t.dashscopeApiKey && !t.dashscopeApiKey.startsWith("••••")) ? t.dashscopeApiKey : (existing.transcription?.dashscopeApiKey || ""),
        ossAccessKeyId: t.ossAccessKeyId ?? existing.transcription?.ossAccessKeyId ?? "",
        ossAccessKeySecret: (t.ossAccessKeySecret && !t.ossAccessKeySecret.startsWith("••••")) ? t.ossAccessKeySecret : (existing.transcription?.ossAccessKeySecret || ""),
        ossBucketName: t.ossBucketName ?? existing.transcription?.ossBucketName ?? "",
        ossEndpoint: t.ossEndpoint ?? existing.transcription?.ossEndpoint ?? "",
        ffmpegPath: t.ffmpegPath ?? existing.transcription?.ffmpegPath ?? "",
      };
    }

    await prisma.user.update({
      where: { id: userId },
      data: { settings: JSON.stringify(updated) },
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

function resolve(settings: UserSettings): UserSettings {
  if (!settings?.providers?.length) return DEFAULTS;
  return {
    providers: settings.providers,
    assignments: {
      chat: settings.assignments?.chat || DEFAULTS.assignments.chat,
      analysis: settings.assignments?.analysis || DEFAULTS.assignments.analysis,
      report: settings.assignments?.report || DEFAULTS.assignments.report,
    },
    prompts: {
      chat: settings.prompts?.chat || "",
      analysis: settings.prompts?.analysis || "",
      report: settings.prompts?.report || "",
    },
    transcription: {
      cookies: settings.transcription?.cookies || "",
      dashscopeApiKey: settings.transcription?.dashscopeApiKey || "",
      ossAccessKeyId: settings.transcription?.ossAccessKeyId || "",
      ossAccessKeySecret: settings.transcription?.ossAccessKeySecret || "",
      ossBucketName: settings.transcription?.ossBucketName || "",
      ossEndpoint: settings.transcription?.ossEndpoint || "",
      ffmpegPath: settings.transcription?.ffmpegPath || "",
    },
  };
}