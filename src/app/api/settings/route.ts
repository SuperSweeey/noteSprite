import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  DEFAULTS,
  Provider,
  SECRET_MASK,
  UserSettings,
  isMaskedSecret,
  resolveSettings,
} from "@/lib/ai-config";

function mask(value?: string | null): string {
  const text = String(value || "");
  return text ? `${SECRET_MASK}${text.slice(-4)}` : "";
}

function keepSecret(incoming?: string, existing?: string): string {
  const value = String(incoming || "").trim();
  if (!value || isMaskedSecret(value)) return existing || "";
  return value;
}

export async function GET() {
  try {
    const userId = await getCurrentUserId();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const resolved = resolveSettings(user?.settings);

    return NextResponse.json({
      ...resolved,
      providers: resolved.providers.map((provider) => ({
        ...provider,
        apiKey: mask(provider.apiKey),
      })),
      transcription: {
        ...resolved.transcription,
        dashscopeApiKey: mask(resolved.transcription.dashscopeApiKey),
        ossAccessKeySecret: mask(resolved.transcription.ossAccessKeySecret),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    const body = await req.json();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const existing = resolveSettings(user?.settings);

    const updated: UserSettings = {
      providers: existing.providers,
      assignments: { ...DEFAULTS.assignments, ...existing.assignments },
      prompts: { ...DEFAULTS.prompts, ...existing.prompts },
      transcription: { ...DEFAULTS.transcription, ...existing.transcription },
      spirit: { ...DEFAULTS.spirit, ...existing.spirit },
      knowledge: { ...DEFAULTS.knowledge, ...existing.knowledge },
    };

    if (body.providers) {
      updated.providers = body.providers.map((provider: Provider) => {
        const oldProvider = existing.providers.find((item) => item.id === provider.id);
        return {
          ...provider,
          apiKey: keepSecret(provider.apiKey, oldProvider?.apiKey),
        };
      });
    }

    if (body.assignments) {
      updated.assignments = { ...updated.assignments, ...body.assignments };
    }
    if (body.prompts) {
      updated.prompts = { ...updated.prompts, ...body.prompts };
    }
    if (body.transcription) {
      const current = existing.transcription;
      const incoming = body.transcription;
      updated.transcription = {
        cookies: incoming.cookies ?? current.cookies ?? "",
        dashscopeApiKey: keepSecret(incoming.dashscopeApiKey, current.dashscopeApiKey),
        ossAccessKeyId: incoming.ossAccessKeyId ?? current.ossAccessKeyId ?? "",
        ossAccessKeySecret: keepSecret(incoming.ossAccessKeySecret, current.ossAccessKeySecret),
        ossBucketName: incoming.ossBucketName ?? current.ossBucketName ?? "",
        ossEndpoint: incoming.ossEndpoint ?? current.ossEndpoint ?? "",
        ffmpegPath: incoming.ffmpegPath ?? current.ffmpegPath ?? "",
      };
    }
    if (body.spirit) {
      updated.spirit = {
        name: body.spirit.name ?? existing.spirit.name,
        personaId: body.spirit.personaId ?? existing.spirit.personaId,
        personaPrompt: body.spirit.personaPrompt ?? existing.spirit.personaPrompt,
        learningModeId: body.spirit.learningModeId ?? existing.spirit.learningModeId,
        learningPrompt: body.spirit.learningPrompt ?? existing.spirit.learningPrompt,
        prompt: body.spirit.prompt ?? existing.spirit.prompt,
      };
    }
    if (body.knowledge) {
      updated.knowledge = {
        defaultSort: body.knowledge.defaultSort ?? existing.knowledge.defaultSort,
        autoAnalyze: Boolean(body.knowledge.autoAnalyze),
        autoReport: Boolean(body.knowledge.autoReport),
        deleteMode: body.knowledge.deleteMode ?? existing.knowledge.deleteMode,
        autoImageOcr: Boolean(body.knowledge.autoImageOcr),
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
