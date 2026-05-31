import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { getTranscriptionConfig, isMaskedSecret, TranscriptionSettings } from "@/lib/ai-config";
import { runTranscriptionPreflight } from "@/lib/transcription-preflight";

function keepSecret(incoming: unknown, existing: string) {
  const value = String(incoming ?? "").trim();
  if (!value || isMaskedSecret(value)) return existing;
  return value;
}

function mergeDraftTranscription(current: TranscriptionSettings, draft: Partial<TranscriptionSettings>): Partial<TranscriptionSettings> {
  return {
    cookies: draft.cookies ?? current.cookies ?? "",
    dashscopeApiKey: keepSecret(draft.dashscopeApiKey, current.dashscopeApiKey),
    ossAccessKeyId: draft.ossAccessKeyId ?? current.ossAccessKeyId ?? "",
    ossAccessKeySecret: keepSecret(draft.ossAccessKeySecret, current.ossAccessKeySecret),
    ossBucketName: draft.ossBucketName ?? current.ossBucketName ?? "",
    ossEndpoint: draft.ossEndpoint ?? current.ossEndpoint ?? "",
    ffmpegPath: draft.ffmpegPath ?? current.ffmpegPath ?? "",
  };
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    const body = await req.json().catch(() => ({}));
    const current = await getTranscriptionConfig(userId);
    const draft = body?.transcription ? mergeDraftTranscription(current, body.transcription) : undefined;
    const result = await runTranscriptionPreflight(userId, draft);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, checks: [], error: e.message }, { status: 500 });
  }
}
