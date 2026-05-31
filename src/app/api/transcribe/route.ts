import { NextRequest, NextResponse } from "next/server";
import { access } from "fs/promises";
import { join } from "path";
import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getTranscriptionConfig, buildTranscriptionEnv } from "@/lib/ai-config";
import { transcribeFile, transcribeUrl, detectPlatform, extractUrl } from "@/lib/transcribe";
import { runTranscriptionPreflight } from "@/lib/transcription-preflight";
import { finishTranscription, markFailed } from "@/lib/transcription-finish";

export async function POST(req: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    const { url: rawInput, noteId } = await req.json();

    let sourceNote:
      | { id: string; title: string; sourceUrl: string | null; contentMd: string; type: string; assets: { id: string; storagePath: string; fileName: string; processingStatus: string }[] }
      | null = null;
    if (noteId) {
      sourceNote = await prisma.note.findFirst({
        where: { id: noteId, userId, deletedAt: null },
        select: {
          id: true,
          title: true,
          sourceUrl: true,
          contentMd: true,
          type: true,
          assets: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { id: true, storagePath: true, fileName: true, processingStatus: true },
          },
        },
      });
      if (!sourceNote) {
        return NextResponse.json({ error: "找不到要重新转录的笔记" }, { status: 404 });
      }
    }

    const latestAsset = sourceNote?.assets?.[0];
    const fallbackUploadPath = sourceNote ? await findUploadPathForBrokenNote(sourceNote) : "";
    const uploadPath = latestAsset?.storagePath || fallbackUploadPath;
    const uploadName = latestAsset?.fileName || sourceNote?.sourceUrl || sourceNote?.title || "";
    const isUploadRetry = Boolean(uploadPath) && (sourceNote?.type === "upload" || looksLikeUploadName(sourceNote?.sourceUrl) || looksLikeUploadName(sourceNote?.title));
    const retryUrl = sourceNote?.sourceUrl || extractUrl(sourceNote?.contentMd || "").url;
    const input = typeof rawInput === "string" && rawInput.trim() ? rawInput : retryUrl;
    if (!isUploadRetry && looksLikeUploadName(sourceNote?.sourceUrl || sourceNote?.title || sourceNote?.contentMd || "")) {
      return NextResponse.json({ error: "这条上传转录笔记缺少原始文件索引，旧版本没有把上传资产保存下来。请重新上传原文件；新上传的笔记已修复这个问题。" }, { status: 409 });
    }
    if (!isUploadRetry && (!input || typeof input !== "string")) {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    const { url: cleanUrl, title: extractedTitle } = extractUrl(input || "");
    const platform = isUploadRetry ? "upload" : detectPlatform(input);

    const note = sourceNote
      ? await prisma.note.update({
          where: { id: sourceNote.id },
          data: {
            title: sourceNote.title || extractedTitle || uploadName || "",
            contentMd: isUploadRetry ? sourceNote.contentMd : cleanUrl,
            plainText: isUploadRetry ? sourceNote.contentMd : cleanUrl,
            type: isUploadRetry ? "upload" : "link",
            sourceUrl: isUploadRetry ? (sourceNote.sourceUrl || uploadName || "") : cleanUrl,
            status: "processing",
          },
          include: { tags: { include: { tag: true } }, assets: true },
        })
      : await prisma.note.create({
          data: {
            userId,
            title: extractedTitle || "",
            contentMd: cleanUrl,
            plainText: cleanUrl,
            type: "link",
            sourceUrl: cleanUrl,
            status: platform ? "processing" : "inbox",
          },
          include: { tags: { include: { tag: true } }, assets: true },
        });

    if (sourceNote) {
      await prisma.aIResult.deleteMany({ where: { noteId: sourceNote.id } });
    }

    if (isUploadRetry) {
      const preflight = await runTranscriptionPreflight(userId);
      if (!preflight.ok) {
        const error = preflight.checks
          .filter((check) => !check.ok)
          .map((check) => `${check.name}：${check.message}`)
          .join("\n");
        await markFailed(note.id, uploadName || sourceNote?.title || "上传文件", "upload", `转录预检失败\n${error}`);
        return NextResponse.json({ note, platform: "upload", preflight, message: "上传文件转录预检失败，已写入笔记状态" });
      }
      const transcriptionConfig = await getTranscriptionConfig(userId);
      const extraEnv = buildTranscriptionEnv(transcriptionConfig);
      runTranscription(note.id, uploadName || sourceNote!.title || "上传文件", userId, "upload", () => transcribeFile(uploadPath, uploadName || sourceNote!.title || "上传文件", extraEnv));
      return NextResponse.json({ note, platform: "upload", message: "已重新启动上传文件转录..." });
    }

    if (platform) {
      const preflight = await runTranscriptionPreflight(userId);
      if (!preflight.ok) {
        const error = preflight.checks
          .filter((check) => !check.ok)
          .map((check) => `${check.name}：${check.message}`)
          .join("\n");
        await markFailed(note.id, cleanUrl, platform, `转录预检失败\n${error}`);
        return NextResponse.json({ note, platform, preflight, message: "转录预检失败，已写入笔记状态" });
      }
      const transcriptionConfig = await getTranscriptionConfig(userId);
      const extraEnv = buildTranscriptionEnv(transcriptionConfig);
      runTranscription(note.id, cleanUrl, userId, platform, () => transcribeUrl(cleanUrl, platform, extraEnv));
    }

    return NextResponse.json({
      note,
      platform: platform || "unknown",
      message: platform
        ? `已识别为 ${platform} 链接，后台处理中...`
        : "已保存链接，暂不支持该平台自动转文字",
    });
  } catch (e: any) {
    console.error("POST /api/transcribe error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

async function runTranscription(
  noteId: string,
  url: string,
  userId: string,
  platform: string,
  run: Parameters<typeof finishTranscription>[4]
) {
  return finishTranscription(noteId, url, userId, platform, run);
}

async function findUploadPathForBrokenNote(note: { sourceUrl: string | null; title: string; contentMd: string }) {
  const candidates = [note.sourceUrl, note.title, note.contentMd]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .filter(looksLikeUploadName);
  for (const name of candidates) {
    const fullPath = join(process.cwd(), "python", "output", "uploads", name);
    try {
      await access(fullPath);
      return fullPath;
    } catch {}
  }
  return "";
}

function looksLikeUploadName(value?: string | null) {
  const text = String(value || "").trim().toLowerCase();
  return /\.(mp3|wav|m4a|aac|flac|ogg|opus|mp4|mov|mkv|webm)$/.test(text) && !/^https?:\/\//.test(text);
}
