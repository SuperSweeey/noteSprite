import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseTags, stripMarkdown } from "@/lib/tags";
import { analyzeNote } from "@/lib/ai";
import { getAIConfig, getTranscriptionConfig, buildTranscriptionEnv } from "@/lib/ai-config";
import { transcribeUrl, detectPlatform, extractUrl } from "@/lib/transcribe";

export async function POST(req: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    const { url: rawInput } = await req.json();

    if (!rawInput || typeof rawInput !== "string") {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    // Extract clean URL and optional title from share text
    const { url: cleanUrl, title: extractedTitle } = extractUrl(rawInput);
    const platform = detectPlatform(rawInput); // detect from raw input (contains domain hints)

    const note = await prisma.note.create({
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

    if (platform) {
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

async function runTranscription(
  noteId: string, url: string, userId: string, platform: string
) {
  // Read user settings for AI analysis + transcription pipeline
  const analysisConfig = await getAIConfig(userId, "analysis");
  const transcriptionConfig = await getTranscriptionConfig(userId);
  const extraEnv = buildTranscriptionEnv(transcriptionConfig);

  // Update note to show processing state
  await prisma.note.update({
    where: { id: noteId },
    data: {
      contentMd: `> [处理中] 正在下载并转写 ${platform} 视频...\n\n${url}`,
      plainText: `[处理中] 正在转写 ${platform} 视频...`,
    },
  });

  try {
    console.log(`[Transcribe] Starting for note ${noteId}, platform: ${platform}`);
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

      // One AI call: title + keywords + suggestedTags
      const analysisOverrides = {
        apiKey: analysisConfig.apiKey || undefined,
        baseUrl: analysisConfig.baseUrl || undefined,
        model: analysisConfig.model || undefined,
      };
      const analysis = await analyzeNote(cleanText, analysisOverrides).catch(() => null);
      // Fallback: first non-empty line of transcription, up to 20 chars
      const fallbackTitle = cleanText.split("\n").find((l) => l.trim().length > 2)?.trim().slice(0, 20) || "";
      const shortTitle = analysis?.title || fallbackTitle || `${platform} 转写`;
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
          status: "inbox",
        },
      });

      // Reconnect tags
      await prisma.noteTag.deleteMany({ where: { noteId } });
      for (const tagId of tagIds) {
        await prisma.noteTag.create({ data: { noteId, tagId } });
        await prisma.tag.update({
          where: { id: tagId },
          data: { noteCount: { increment: 1 } },
        });
      }

      // Save AI result (keywords + suggestedTags; title already used above)
      if (analysis) {
        await prisma.aIResult.create({
          data: {
            noteId,
            model: analysisConfig.model || "deepseek-v4-flash",
            summary: analysis.title,
            keyPoints: JSON.stringify(analysis.keywords),
            keywords: JSON.stringify(analysis.keywords),
            suggestedTags: JSON.stringify(analysis.suggestedTags),
          },
        }).catch((e) => console.error(`[AI] Save AIResult failed for note ${noteId}:`, e));
      }

      console.log(`[Transcribe] Done: note ${noteId} (${cleanText.length} chars)`);
    } else {
      await markFailed(noteId, url, platform, result.error || "转录失败");
    }
  } catch (e: any) {
    console.error(`[Transcribe] Failed for note ${noteId}:`, e);
    let errMsg = e.message || "转录失败";
    // Add cookies hint for douyin CAPTURE_FAILED
    if (platform === "douyin" && errMsg.includes("CAPTURE_FAILED")) {
      errMsg += "\n\n💡 抖音需要 cookies 才能下载。请在 python/ 目录下放置 cookies.txt 文件（Netscape 格式）。可从浏览器导出。";
    }
    await markFailed(noteId, url, platform, errMsg);
  }
}

async function markFailed(noteId: string, url: string, platform: string, error: string) {
  await prisma.note.update({
    where: { id: noteId },
    data: {
      contentMd: `> [失败] ${platform} 视频转写失败\n> ${error}\n\n${url}`,
      plainText: `[失败] ${error}`,
      status: "inbox",
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
      const created = await prisma.tag.create({
        data: { userId, name: parts[i], fullPath: currentPath, parentId },
      });
      parentId = created.id;
      leafId = created.id;
    }
  }
  return leafId!;
}
