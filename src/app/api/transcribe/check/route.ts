import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { runTranscriptionPreflight } from "@/lib/transcription-preflight";

export async function POST() {
  try {
    const userId = await getCurrentUserId();
    const result = await runTranscriptionPreflight(userId);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, checks: [], error: e.message }, { status: 500 });
  }
}
