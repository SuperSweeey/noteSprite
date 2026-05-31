import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  DEFAULTS,
  Provider,
  SECRET_MASK,
  UserSettings,
  isMaskedSecret,
  looksMojibake,
  resolveTranscriptionRuntimeConfig,
  resolveSettings,
} from "@/lib/ai-config";

export const dynamic = "force-dynamic";

function mask(value?: string | null): string {
  const text = String(value || "");
  return text ? `${SECRET_MASK}${text.slice(-4)}` : "";
}

function keepSecret(incoming?: string, existing?: string): string {
  const value = String(incoming || "").trim();
  if (!value || isMaskedSecret(value)) return existing || "";
  return value;
}

function keepPrompt(incoming: unknown, existing: string, fallback: string): string {
  const value = String(incoming ?? "").trim();
  if (!value) return existing || fallback;
  if (looksMojibake(value)) return existing && !looksMojibake(existing) ? existing : fallback;
  return value;
}

export async function GET() {
  try {
    const userId = await getCurrentUserId();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const resolved = resolveSettings(user?.settings);
    const transcriptionRuntime = await resolveTranscriptionRuntimeConfig(userId);

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
      transcriptionRuntime: {
        effective: {
          dashscopeApiKey: mask(transcriptionRuntime.dashscopeApiKey),
          ossAccessKeyId: transcriptionRuntime.ossAccessKeyId ? `${transcriptionRuntime.ossAccessKeyId.slice(0, 4)}...${transcriptionRuntime.ossAccessKeyId.slice(-4)}` : "",
          ossAccessKeySecret: mask(transcriptionRuntime.ossAccessKeySecret),
          ossBucketName: transcriptionRuntime.ossBucketName,
          ossEndpoint: transcriptionRuntime.ossEndpoint,
          ffmpegPath: transcriptionRuntime.ffmpegPath,
          cookies: transcriptionRuntime.cookies ? "已配置" : "",
        },
        sources: transcriptionRuntime.sources,
        warnings: transcriptionRuntime.warnings,
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
      appearance: { ...DEFAULTS.appearance, ...existing.appearance },
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
      updated.prompts = {
        chat: keepPrompt(body.prompts.chat, existing.prompts.chat, DEFAULTS.prompts.chat),
        analysis: keepPrompt(body.prompts.analysis, existing.prompts.analysis, DEFAULTS.prompts.analysis),
        report: keepPrompt(body.prompts.report, existing.prompts.report, DEFAULTS.prompts.report),
      };
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
        enableTimestamps: incoming.enableTimestamps ?? current.enableTimestamps ?? DEFAULTS.transcription.enableTimestamps,
        enableSpeakerDiarization: incoming.enableSpeakerDiarization ?? current.enableSpeakerDiarization ?? DEFAULTS.transcription.enableSpeakerDiarization,
        speakerCount: Number(incoming.speakerCount ?? current.speakerCount ?? DEFAULTS.transcription.speakerCount) || 0,
      };
    }
    if (body.spirit) {
      updated.spirit = {
        name: body.spirit.name ?? existing.spirit.name,
        personaId: body.spirit.personaId ?? existing.spirit.personaId,
        personaPrompt: keepPrompt(body.spirit.personaPrompt, existing.spirit.personaPrompt, DEFAULTS.spirit.personaPrompt),
        learningModeId: body.spirit.learningModeId ?? existing.spirit.learningModeId,
        learningPrompt: keepPrompt(body.spirit.learningPrompt, existing.spirit.learningPrompt, DEFAULTS.spirit.learningPrompt),
        prompt: keepPrompt(body.spirit.prompt, existing.spirit.prompt, DEFAULTS.spirit.prompt),
      };
    }
    if (body.knowledge) {
      updated.knowledge = {
        defaultSort: body.knowledge.defaultSort ?? existing.knowledge.defaultSort,
        autoAnalyze: body.knowledge.autoAnalyze ?? existing.knowledge.autoAnalyze,
        autoReport: body.knowledge.autoReport ?? existing.knowledge.autoReport,
        deleteMode: body.knowledge.deleteMode ?? existing.knowledge.deleteMode,
        autoImageOcr: body.knowledge.autoImageOcr ?? existing.knowledge.autoImageOcr,
      };
    }
    if (body.appearance) {
      updated.appearance = {
        fontFamily: body.appearance.fontFamily ?? existing.appearance.fontFamily,
        customFontFamily: body.appearance.customFontFamily ?? existing.appearance.customFontFamily,
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
