import { mkdir, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import { join } from "path";
import { prisma } from "@/lib/prisma";
import { parseTags, stripMarkdown } from "@/lib/tags";
import { analyzeNote } from "@/lib/ai";
import { buildTranscriptionEnv, getAIConfig, getTranscriptionConfig, resolveSettings } from "@/lib/ai-config";
import { transcribeFile } from "@/lib/transcribe";
import { runTranscriptionPreflight } from "@/lib/transcription-preflight";
import { finishTranscription } from "@/lib/transcription-finish";
import { detectPlatform } from "@/lib/transcribe";
import { ensureTagHierarchy } from "@/lib/tags-db";

export const MAX_DROP_FILE_BYTES = 600 * 1024 * 1024;

const MEDIA_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".mp4", ".mov", ".mkv", ".webm"]);
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif"]);

export type DropResult =
  | { kind: "text"; note: any; message: string }
  | { kind: "link"; note: any; platform: string; message: string }
  | { kind: "media"; note: any; message: string }
  | { kind: "image"; note: any; message: string };

export async function createTextDrop(userId: string, text: string): Promise<DropResult> {
  const content = text.trim();
  if (!content) {
    throw new DropError("请先丢进来一点内容。", 400);
  }

  if (looksLikeUrl(content)) {
    return createLinkDrop(userId, content);
  }

  const tagPaths = parseTags(content);
  const allTagIds: string[] = [];
  for (const fullPath of tagPaths) {
    const ids = await ensureTagHierarchy(userId, fullPath);
    allTagIds.push(...ids);
  }
  const uniqueTagIds = Array.from(new Set(allTagIds));
  const note = await prisma.note.create({
    data: {
      userId,
      contentMd: content,
      plainText: stripMarkdown(content),
      status: "inbox",
      tags: {
        create: uniqueTagIds.map((tagId) => ({ tag: { connect: { id: tagId } } })),
      },
    },
    include: { tags: { include: { tag: true } } },
  });
  for (const tagId of uniqueTagIds) {
    await prisma.tag.update({ where: { id: tagId }, data: { noteCount: { increment: 1 } } });
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { settings: true } });
  const settings = resolveSettings(user?.settings);
  if (settings.knowledge.autoAnalyze) {
    runAIAnalysis(note.id, content, userId);
  }

  return { kind: "text", note, message: "已经收成文字笔记。" };
}

export async function createLinkDrop(userId: string, rawUrl: string): Promise<DropResult> {
  const url = rawUrl.trim();
  if (!looksLikeUrl(url)) {
    throw new DropError("这不像一条可处理的链接。", 400);
  }

  const platform = detectPlatform(url) || "link";
  const note = await prisma.note.create({
    data: {
      userId,
      title: "",
      contentMd: `> [处理中] 正在抓取并转写 ${platform} 视频...\n\n${url}`,
      plainText: `[处理中] 正在抓取并转写 ${platform} 视频...`,
      type: "link",
      sourceUrl: url,
      status: "processing",
    },
    include: { tags: { include: { tag: true } } },
  });

  const { transcribeUrl } = await import("@/lib/transcribe");
  const transcriptionConfig = await getTranscriptionConfig(userId);
  const extraEnv = buildTranscriptionEnv(transcriptionConfig);
  finishTranscription(note.id, url, userId, platform, () => transcribeUrl(url, platform, extraEnv)).catch((error) => {
    console.error("[DropLink] background failed:", error);
  });

  return { kind: "link", note, platform, message: "已经收下链接，正在后台处理。" };
}

export async function createFileDrop(userId: string, file: File): Promise<DropResult> {
  if (!(file instanceof File)) {
    throw new DropError("请选择一个文件。", 400);
  }
  if (file.size <= 0) {
    throw new DropError("文件为空，无法处理。", 400);
  }
  if (file.size > MAX_DROP_FILE_BYTES) {
    throw new DropError("文件太大了。当前最多支持 600MB。", 413);
  }

  const originalName = sanitizeFileName(file.name || "upload.bin");
  const extension = getExtension(originalName);
  const mimeType = file.type || "application/octet-stream";
  const kind = classifyFile(extension, mimeType);
  if (kind === "unsupported") {
    throw new DropError("暂不支持这个文件格式。请丢图片、音频或视频文件。", 400);
  }

  const localFile = await persistDropFile(file, extension);
  if (kind === "image") {
    return createImageDrop(userId, file, originalName, localFile, extension);
  }
  return createMediaDrop(userId, file, originalName, localFile, extension);
}

async function createMediaDrop(userId: string, file: File, originalName: string, localFile: string, extension: string): Promise<DropResult> {
  const preflight = await runTranscriptionPreflight(userId);
  if (!preflight.ok) {
    const error = preflight.checks
      .filter((check) => !check.ok)
      .map((check) => `${check.name}：${check.message}`)
      .join("\n");
    throw new DropError(`转录预检失败\n${error}`, 400, preflight);
  }

  const fileType = isVideoExtension(extension) ? "video" : "audio";
  const note = await prisma.note.create({
    data: {
      userId,
      title: originalName,
      contentMd: `> [处理中] 正在转写上传文件...\n\n${originalName}`,
      plainText: `[处理中] 正在转写上传文件 ${originalName}`,
      type: "upload",
      sourceUrl: originalName,
      status: "processing",
      assets: {
        create: {
          userId,
          fileName: originalName,
          fileType,
          mimeType: file.type || "application/octet-stream",
          fileSize: clampFileSize(file.size),
          storagePath: localFile,
          storageUrl: "",
          processingStatus: "processing",
        },
      },
    },
    include: { tags: { include: { tag: true } }, assets: true },
  });

  const transcriptionConfig = await getTranscriptionConfig(userId);
  const extraEnv = buildTranscriptionEnv(transcriptionConfig);
  finishTranscription(note.id, originalName, userId, "upload", () => transcribeFile(localFile, originalName, extraEnv)).catch((error) => {
    console.error("[DropMedia] background failed:", error);
  });

  return { kind: "media", note, message: "已经收到音视频，正在后台转录。" };
}

async function createImageDrop(userId: string, file: File, originalName: string, localFile: string, extension: string): Promise<DropResult> {
  const content = [
    `# ${titleFromFileName(originalName)}`,
    "",
    `![${escapeMarkdown(originalName)}](/api/assets/__ASSET_ID__/file)`,
    "",
    `> 图片文件：${originalName}`,
    "",
    "图片理解待处理。配置图片理解模型后，可以生成 OCR、图片描述和摘要。",
  ].join("\n");

  const note = await prisma.note.create({
    data: {
      userId,
      title: titleFromFileName(originalName),
      contentMd: content,
      plainText: `${titleFromFileName(originalName)}\n图片文件：${originalName}`,
      type: "image",
      sourceUrl: originalName,
      status: "inbox",
      assets: {
        create: {
          userId,
          fileName: originalName,
          fileType: "image",
          mimeType: file.type || mimeFromImageExtension(extension),
          fileSize: clampFileSize(file.size),
          storagePath: localFile,
          storageUrl: "",
          processingStatus: "completed",
        },
      },
    },
    include: { tags: { include: { tag: true } }, assets: true },
  });

  const assetId = note.assets?.[0]?.id;
  const contentWithAsset = assetId ? content.replace("__ASSET_ID__", assetId) : content.replace("/api/assets/__ASSET_ID__/file", "");
  const updated = await prisma.note.update({
    where: { id: note.id },
    data: {
      contentMd: contentWithAsset,
      plainText: stripMarkdown(contentWithAsset),
    },
    include: { tags: { include: { tag: true } }, assets: true },
  });

  return { kind: "image", note: updated, message: "图片已经收好。" };
}

export class DropError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status = 500, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function looksLikeUrl(text: string) {
  try {
    const url = new URL(text.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function classifyFile(extension: string, mimeType: string): "image" | "media" | "unsupported" {
  if (mimeType.startsWith("image/") || IMAGE_EXTENSIONS.has(extension)) return "image";
  if (mimeType.startsWith("audio/") || mimeType.startsWith("video/") || MEDIA_EXTENSIONS.has(extension)) return "media";
  return "unsupported";
}

async function persistDropFile(file: File, extension: string) {
  const uploadDir = join(process.cwd(), "python", "output", "uploads");
  await mkdir(uploadDir, { recursive: true });
  const localFile = join(uploadDir, `${Date.now()}_${randomUUID()}${extension || ".bin"}`);
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(localFile, bytes);
  return localFile;
}

export function sanitizeFileName(name: string) {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, "_").trim();
  return stripMarkdown(cleaned).slice(0, 120) || "upload";
}

export function getExtension(name: string) {
  const match = name.toLowerCase().match(/\.[a-z0-9]+$/);
  return match?.[0] || "";
}

function isVideoExtension(extension: string) {
  return [".mp4", ".mov", ".mkv", ".webm"].includes(extension);
}

function titleFromFileName(fileName: string) {
  return fileName.replace(/\.[a-z0-9]+$/i, "").trim() || "图片笔记";
}

function escapeMarkdown(text: string) {
  return text.replace(/([\\[\]])/g, "\\$1");
}

function mimeFromImageExtension(extension: string) {
  const map: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
    ".avif": "image/avif",
  };
  return map[extension] || "image/jpeg";
}

function clampFileSize(size: number) {
  return Math.min(size, 2147483647);
}

async function runAIAnalysis(noteId: string, content: string, userId: string) {
  try {
    const config = await getAIConfig(userId, "analysis");
    if (!config.apiKey) return;
    const result = await analyzeNote(content, {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
    });
    if (!result) return;
    await prisma.aIResult.create({
      data: {
        noteId,
        model: config.model || "deepseek-v4-flash",
        summary: result.summary,
        keyPoints: JSON.stringify(result.keyPoints),
        keywords: JSON.stringify(result.keywords),
        suggestedTags: JSON.stringify(result.suggestedTags),
      },
    });
  } catch (error) {
    console.error(`[DropText] AI analysis failed for note ${noteId}:`, error);
  }
}
