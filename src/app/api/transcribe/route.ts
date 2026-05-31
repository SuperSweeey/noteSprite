import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseTags, stripMarkdown } from "@/lib/tags";
import { analyzeNote } from "@/lib/ai";
import { buildSpiritPrompt, getAIConfig, getSpiritConfig, getTranscriptionConfig, buildTranscriptionEnv, resolveSettings } from "@/lib/ai-config";
import { transcribeUrl, detectPlatform, extractUrl } from "@/lib/transcribe";
import { runTranscriptionPreflight } from "@/lib/transcription-preflight";

export async function POST(req: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    const { url: rawInput, noteId } = await req.json();

    let sourceNote:
      | { id: string; title: string; sourceUrl: string | null; contentMd: string }
      | null = null;
    if (noteId) {
      sourceNote = await prisma.note.findFirst({
        where: { id: noteId, userId, deletedAt: null },
        select: { id: true, title: true, sourceUrl: true, contentMd: true },
      });
      if (!sourceNote) {
        return NextResponse.json({ error: "找不到要重新转录的笔记" }, { status: 404 });
      }
    }

    const retryUrl = sourceNote?.sourceUrl || extractUrl(sourceNote?.contentMd || "").url;
    const input = typeof rawInput === "string" && rawInput.trim() ? rawInput : retryUrl;
    if (!input || typeof input !== "string") {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    const { url: cleanUrl, title: extractedTitle } = extractUrl(input);
    const platform = detectPlatform(input);

    const note = sourceNote
      ? await prisma.note.update({
          where: { id: sourceNote.id },
          data: {
            title: sourceNote.title || extractedTitle || "",
            contentMd: cleanUrl,
            plainText: cleanUrl,
            type: "link",
            sourceUrl: cleanUrl,
            status: platform ? "processing" : "inbox",
          },
          include: { tags: { include: { tag: true } } },
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
          include: { tags: { include: { tag: true } } },
        });

    if (sourceNote) {
      await prisma.aIResult.deleteMany({ where: { noteId: sourceNote.id } });
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
      runTranscription(note.id, cleanUrl, userId, platform);
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

async function runTranscription(noteId: string, url: string, userId: string, platform: string) {
  const analysisConfig = await getAIConfig(userId, "analysis");
  const reportConfig = await getAIConfig(userId, "report");
  const spirit = await getSpiritConfig(userId);
  const transcriptionConfig = await getTranscriptionConfig(userId);
  const extraEnv = buildTranscriptionEnv(transcriptionConfig);
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { settings: true } });
  const settings = resolveSettings(user?.settings);

  await prisma.note.update({
    where: { id: noteId },
    data: {
      contentMd: `> [处理中] 正在下载并转写 ${platform} 视频...\n\n${url}`,
      plainText: `[处理中] 正在转写 ${platform} 视频...`,
      status: "processing",
    },
  });

  try {
    const result = await transcribeUrl(url, platform, extraEnv);

    if (result.success && result.text) {
      const cleanText = result.text
        .replace(/^URL:.*\n/gm, "")
        .replace(/^Task ID:.*\n/gm, "")
        .replace(/^Time:.*\n/gm, "")
        .replace(/^=+\n*/gm, "")
        .trim();

      if (cleanText.length < 10) {
        await markFailed(noteId, url, platform, "转录结果过短");
        return;
      }

      const analysisOverrides = {
        apiKey: analysisConfig.apiKey || undefined,
        baseUrl: analysisConfig.baseUrl || undefined,
        model: analysisConfig.model || undefined,
      };
      const analysis = await analyzeNote(cleanText, analysisOverrides).catch(() => null);
      const shortTitle = analysis?.title?.trim() || buildFallbackTitle(platform, url);
      const fullContent = `# ${shortTitle}\n\n**来源：** ${url}\n**平台：** ${platform}\n\n---\n\n${cleanText}`;

      const tagPaths = parseTags(fullContent);
      const tagIds: string[] = [];
      for (const tagPath of tagPaths) {
        const tagId = await ensureTag(userId, tagPath);
        tagIds.push(tagId);
      }

      await prisma.note.update({
        where: { id: noteId },
        data: {
          title: shortTitle,
          contentMd: fullContent,
          plainText: stripMarkdown(fullContent),
          type: platform as any,
          sourceUrl: url,
          status: "inbox",
        },
      });

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
      await markFailed(noteId, url, platform, result.error || "转录失败");
    }
  } catch (e: any) {
    let errMsg = e.message || "转录失败";
    if (platform === "douyin" && errMsg.includes("CAPTURE_FAILED")) {
      errMsg += "\n\n提示：抖音可能需要有效 cookies。请在设置页更新 cookies 后再试。";
    }
    await markFailed(noteId, url, platform, errMsg);
  }
}

async function markFailed(noteId: string, url: string, platform: string, error: string) {
  await prisma.aIResult.deleteMany({ where: { noteId } });
  await prisma.note.update({
    where: { id: noteId },
    data: {
      contentMd: `> [失败] ${platform} 视频转写失败\n> ${error.replace(/\n/g, "\n> ")}\n\n${url}`,
      plainText: `[失败] ${error}`,
      type: platform as any,
      sourceUrl: url,
      status: "failed",
    },
  });
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

function buildFallbackTitle(platform: string, url: string) {
  const today = new Date().toISOString().slice(0, 10);
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    host = "";
  }
  const source = platform || host || "外部资料";
  return `${source} 转录笔记 ${today}`;
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
  return String(json.choices?.[0]?.message?.content || "").trim();
}
