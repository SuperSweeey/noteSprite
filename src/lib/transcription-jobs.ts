import { prisma } from "@/lib/prisma";

export const TRANSCRIPTION_STALE_MINUTES = 15;

export function isTranscriptionStale(updatedAt: Date, now = new Date()) {
  return now.getTime() - updatedAt.getTime() > TRANSCRIPTION_STALE_MINUTES * 60 * 1000;
}

export function buildProcessingContent(platform: string, url: string, stage = "排队中", jobId?: string) {
  return [
    `> [处理中] ${stage}`,
    `> 平台：${platform}`,
    jobId ? `> 任务：${jobId}` : "",
    `> 超过 ${TRANSCRIPTION_STALE_MINUTES} 分钟没有进展会自动标记失败，方便你重新转录。`,
    "",
    url,
  ].filter(Boolean).join("\n");
}

export function buildFailedContent(platform: string, url: string, error: string) {
  return `> [失败] ${platform} 视频转写失败\n> ${error.replace(/\n/g, "\n> ")}\n\n${url}`;
}

export async function markStaleTranscriptions(userId?: string) {
  const staleBefore = new Date(Date.now() - TRANSCRIPTION_STALE_MINUTES * 60 * 1000);
  const staleNotes = await prisma.note.findMany({
    where: {
      status: "processing",
      deletedAt: null,
      updatedAt: { lt: staleBefore },
      ...(userId ? { userId } : {}),
    },
    select: { id: true, type: true, sourceUrl: true, contentMd: true },
    take: 50,
  });

  if (staleNotes.length === 0) return 0;

  for (const note of staleNotes) {
    const url = note.sourceUrl || extractFirstUrl(note.contentMd) || "";
    const platform = note.type === "link" ? "外部链接" : note.type || "外部链接";
    const error = `转录任务超过 ${TRANSCRIPTION_STALE_MINUTES} 分钟没有进展，系统已停止等待。请点击“重新转录”。`;
    await prisma.aIResult.deleteMany({ where: { noteId: note.id } });
    await prisma.note.update({
      where: { id: note.id },
      data: {
        status: "failed",
        contentMd: buildFailedContent(platform, url, error),
        plainText: `[失败] ${error}`,
      },
    });
  }

  return staleNotes.length;
}

function extractFirstUrl(text: string) {
  return text.match(/https?:\/\/[^\s]+/)?.[0]?.replace(/[。，！？、…]+$/, "") || "";
}
