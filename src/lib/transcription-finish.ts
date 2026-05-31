import { prisma } from "@/lib/prisma";
import { parseTags, stripMarkdown } from "@/lib/tags";
import { analyzeNote } from "@/lib/ai";
import { buildSpiritPrompt, getAIConfig, getSpiritConfig, resolveSettings } from "@/lib/ai-config";
import { modelWasTruncated, pickAssistantContent } from "@/lib/ai-output";
import { TranscribeResult } from "@/lib/transcribe";

export async function finishTranscription(
  noteId: string,
  source: string,
  userId: string,
  platform: string,
  run: () => Promise<TranscribeResult>
) {
  const analysisConfig = await getAIConfig(userId, "analysis");
  const reportConfig = await getAIConfig(userId, "report");
  const spirit = await getSpiritConfig(userId);
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { settings: true } });
  const settings = resolveSettings(user?.settings);

  const started = await updateNoteQuietly(noteId, {
    where: { id: noteId },
    data: {
      contentMd: `> [处理中] 正在转写 ${platform === "upload" ? "上传文件" : `${platform} 视频`}...\n\n${source}`,
      plainText: `[处理中] 正在转写 ${platform === "upload" ? "上传文件" : `${platform} 视频`}...`,
      status: "processing",
    },
  });
  if (!started) return;
  await updateLatestAssetStatus(noteId, "processing");

  try {
    const result = await run();

    if (result.success && result.text) {
      const cleanText = result.text
        .replace(/^URL:.*\n/gm, "")
        .replace(/^Task ID:.*\n/gm, "")
        .replace(/^Time:.*\n/gm, "")
        .replace(/^=+\n*/gm, "")
        .trim();

      if (cleanText.length < 10) {
        await markFailed(noteId, source, platform, "转录结果过短");
        return;
      }

      const analysisOverrides = {
        apiKey: analysisConfig.apiKey || undefined,
        baseUrl: analysisConfig.baseUrl || undefined,
        model: analysisConfig.model || undefined,
      };
      const analysis = await analyzeNote(cleanText, analysisOverrides).catch(() => null);
      const shortTitle = analysis?.title?.trim() || buildFallbackTitle(platform, source);
      const sourceLabel = platform === "upload" ? "上传文件" : "来源";
      const fullContent = `# ${shortTitle}\n\n**${sourceLabel}：** ${source}\n**类型：** ${platform === "upload" ? "本地上传" : platform}\n\n---\n\n${cleanText}`;

      const tagPaths = parseTags(fullContent);
      const tagIds: string[] = [];
      for (const tagPath of tagPaths) {
        const tagId = await ensureTag(userId, tagPath);
        tagIds.push(tagId);
      }

      const updated = await updateNoteQuietly(noteId, {
        where: { id: noteId },
        data: {
          title: shortTitle,
          contentMd: fullContent,
          plainText: stripMarkdown(fullContent),
          type: platform as any,
          sourceUrl: source,
          status: "inbox",
        },
      });
      if (!updated) return;
      await updateLatestAssetStatus(noteId, "completed");

      await prisma.noteTag.deleteMany({ where: { noteId } });
      for (const tagId of Array.from(new Set(tagIds))) {
        await prisma.noteTag.create({ data: { noteId, tagId } });
        await prisma.tag.update({
          where: { id: tagId },
          data: { noteCount: { increment: 1 } },
        });
      }

      const report = settings.knowledge.autoReport
        ? await generateDeepReport(cleanText, {
            apiKey: reportConfig.apiKey,
            baseUrl: reportConfig.baseUrl,
            model: reportConfig.model,
            prompt: buildSpiritPrompt(spirit, reportConfig.prompt),
          }).catch((e) => {
            console.error(`[AI] Auto report failed for note ${noteId}:`, e);
            return "";
          })
        : "";

      if (analysis || report) {
        await prisma.aIResult.create({
          data: {
            noteId,
            model: report ? reportConfig.model || analysisConfig.model || "deepseek-v4-flash" : analysisConfig.model || "deepseek-v4-flash",
            summary: analysis?.summary || "",
            keyPoints: JSON.stringify(analysis?.keyPoints || []),
            keywords: JSON.stringify(analysis?.keywords || []),
            suggestedTags: JSON.stringify(analysis?.suggestedTags || []),
            actionItems: report,
          },
        }).catch((e) => console.error(`[AI] Save AIResult failed for note ${noteId}:`, e));
      }
    } else {
      await markFailed(noteId, source, platform, result.error || "转录失败");
    }
  } catch (e: any) {
    let errMsg = e.message || "转录失败";
    if (platform === "douyin" && errMsg.includes("CAPTURE_FAILED")) {
      errMsg += "\n\n提示：抖音可能需要有效 cookies。请在设置页更新 cookies 后再试。";
    }
    await markFailed(noteId, source, platform, errMsg);
  }
}

export async function markFailed(noteId: string, source: string, platform: string, error: string) {
  await prisma.aIResult.deleteMany({ where: { noteId } });
  const updated = await updateNoteQuietly(noteId, {
    where: { id: noteId },
    data: {
      contentMd: `> [失败] ${platform === "upload" ? "上传文件" : `${platform} 视频`}转写失败\n> ${error.replace(/\n/g, "\n> ")}\n\n${source}`,
      plainText: `[失败] ${error}`,
      type: platform as any,
      sourceUrl: source,
      status: "failed",
    },
  });
  if (!updated) return;
  await updateLatestAssetStatus(noteId, "failed");
}

async function ensureTag(userId: string, fullPath: string): Promise<string> {
  const parts = fullPath.split("/");
  let parentId: string | null = null;
  let leafId: string | null = null;

  for (let i = 0; i < parts.length; i++) {
    const currentPath = parts.slice(0, i + 1).join("/");
    const existing = await prisma.tag.findFirst({
      where: { userId, fullPath: currentPath },
    });
    if (existing) {
      parentId = existing.id;
      leafId = existing.id;
    } else {
      const created: { id: string } = await prisma.tag.create({
        data: { userId, name: parts[i], fullPath: currentPath, parentId },
        select: { id: true },
      });
      parentId = created.id;
      leafId = created.id;
    }
  }
  return leafId!;
}

function buildFallbackTitle(platform: string, source: string) {
  const today = new Date().toISOString().slice(0, 10);
  let host = "";
  try {
    host = new URL(source).hostname.replace(/^www\./, "");
  } catch {
    host = "";
  }
  const label = platform === "upload" ? "上传文件" : platform || host || "外部资料";
  return `${label} 转录笔记 ${today}`;
}

async function generateDeepReport(
  content: string,
  config: { apiKey: string; baseUrl: string; model: string; prompt: string }
) {
  if (!config.apiKey) return "";
  const resp = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: config.prompt },
        {
          role: "user",
          content: `请完整解读这条外部资料转录笔记。解读稿要能替代原文阅读。\n\n笔记原文：\n${content.slice(0, 12000)}`,
        },
      ],
      max_tokens: 3000,
      temperature: 0.45,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${text.slice(0, 300)}`);
  }

  const json = await resp.json();
  const choice = json.choices?.[0] || {};
  if (modelWasTruncated(choice)) {
    throw new Error("AI report truncated by model token limit");
  }
  return pickAssistantContent(choice);
}

async function updateLatestAssetStatus(noteId: string, status: "processing" | "completed" | "failed") {
  const latest = await prisma.asset.findFirst({
    where: { noteId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!latest) return;
  await prisma.asset.update({
    where: { id: latest.id },
    data: { processingStatus: status },
  }).catch(() => {});
}

async function updateNoteQuietly(noteId: string, args: Parameters<typeof prisma.note.update>[0]) {
  try {
    await prisma.note.update(args);
    return true;
  } catch (error: any) {
    if (error?.code === "P2025") {
      console.warn(`[Transcription] Note ${noteId} no longer exists; skipping background update.`);
      return false;
    }
    throw error;
  }
}
