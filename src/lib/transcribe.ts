import { exec } from "child_process";
import { readFile } from "fs/promises";
import { basename, join } from "path";
import { promisify } from "util";
import { formatFriendlyTranscriptionError } from "@/lib/transcription-errors";

const execAsync = promisify(exec);

const PYTHON_DIR = join(process.cwd(), "python");
const MAIN_PY = join(PYTHON_DIR, "main.py");
const OUTPUT_DIR = join(PYTHON_DIR, "output", "transcripts");

const PLATFORM_MAP: Record<string, string> = {
  douyin: "douyin",
  "v.douyin.com": "douyin",
  "www.douyin.com": "douyin",
  bilibili: "bilibili",
  "b23.tv": "bilibili",
  "www.bilibili.com": "bilibili",
  youtube: "youtube",
  "youtu.be": "youtube",
  "www.youtube.com": "youtube",
  xiaohongshu: "xiaohongshu",
  "xhslink.com": "xiaohongshu",
  "www.xiaohongshu.com": "xiaohongshu",
};

export interface TranscribeResult {
  success: boolean;
  taskId: string;
  text?: string;
  platform?: string;
  url?: string;
  error?: string;
  transcriptFile?: string;
}

function parseFailureOutput(stdout = "", stderr = ""): Partial<TranscribeResult> & { stage?: string } | null {
  const text = `${stdout}\n${stderr}`;
  const candidates = text.match(/\{[\s\S]*?"task_status"\s*:\s*"failed"[\s\S]*?\}/g);
  if (!candidates?.length) return null;

  for (const candidate of candidates.reverse()) {
    try {
      const parsed = JSON.parse(candidate);
      return {
        taskId: parsed.task_id || "",
        platform: parsed.platform,
        url: parsed.url,
        error: parsed.error,
        stage: parsed.stage,
      };
    } catch {}
  }
  return null;
}

function formatPipelineError(error: string, stage?: string): string {
  const prefix = stage ? `阶段：${stage}\n` : "";
  if (error.includes("ffmpeg")) {
    return `${prefix}${error}\n\n建议：在设置页填写 ffmpeg.exe 的完整路径，或清空错误路径让系统自动使用 PATH 中的 ffmpeg。`;
  }
  if (error.includes("InvalidApiKey") || error.includes("Invalid API-key")) {
    return `${prefix}${error}\n\n建议：检查转录设置里的 DashScope API Key。这里要填阿里云百炼/DashScope 的模型 API Key，不是 OSS AccessKey ID，也不是 OSS AccessKey Secret。`;
  }
  if (error.includes("SignatureDoesNotMatch") || error.includes("AccessDenied") || error.includes("OSS") || error.includes("403")) {
    return formatFriendlyTranscriptionError(error, stage);
  }
  if (error.includes("cookies") || error.includes("登录")) {
    return `${prefix}${error}\n\n建议：更新平台 cookies 后再试。`;
  }
  return formatFriendlyTranscriptionError(error, stage) || `${prefix}${error}`;
}

export function extractUrl(text: string): { url: string; title?: string } {
  const urlMatch = text.match(/https?:\/\/[^\s]+/);
  const cleanUrl = urlMatch ? urlMatch[0].replace(/[。，！？、…]+$/, "") : text.trim();
  const titleMatch = text.match(/【(.+?)】/) || text.match(/《(.+?)》/);
  return { url: cleanUrl, title: titleMatch?.[1] };
}

export function detectPlatform(url: string): string | null {
  for (const [key, platform] of Object.entries(PLATFORM_MAP)) {
    if (url.includes(key)) return platform;
  }
  return null;
}

export async function transcribeUrl(
  url: string,
  platform?: string,
  extraEnv?: Record<string, string>
): Promise<TranscribeResult> {
  const detected = platform || detectPlatform(url);
  if (!detected) {
    return { success: false, taskId: "", error: "不支持的链接类型，目前支持：抖音、B站、YouTube、小红书" };
  }

  let cookiesPath = "";
  if (extraEnv?.COOKIES) {
    const { writeFile } = await import("fs/promises");
    const { join } = await import("path");
    const { tmpdir } = await import("os");
    cookiesPath = join(tmpdir(), `nf_cookies_${Date.now()}.txt`);
    await writeFile(cookiesPath, extraEnv.COOKIES, "utf-8");
  }

  try {
    const cmd = `python "${MAIN_PY}" --platform ${detected} --url "${url}"${cookiesPath ? ` --cookies "${cookiesPath}"` : ""}`;
    const env = { ...process.env, ...extraEnv };
    if (cookiesPath) env.COOKIES_PATH = cookiesPath;

    const { stdout, stderr } = await execAsync(cmd, {
      timeout: 900000,
      maxBuffer: 4 * 1024 * 1024,
      env,
    });

    const taskIdMatch =
      stdout.match(/\[([a-f0-9]{8})\]/) ||
      stderr.match(/\[([a-f0-9]{8})\]/) ||
      stdout.match(/task_id.*?([a-f0-9]{8})/) ||
      stderr.match(/task_id.*?([a-f0-9]{8})/);
    const taskId = taskIdMatch ? taskIdMatch[1] : "";

    if (taskId) {
      const transcriptPath = join(OUTPUT_DIR, `transcript_${taskId}.txt`);
      try {
        const text = await readFile(transcriptPath, "utf-8");
        return { success: true, taskId, text, platform: detected, url, transcriptFile: transcriptPath };
      } catch {
        const previewMatch = stdout.match(/转录预览[\s\S]*?\n([\s\S]*?)\n\n/);
        if (previewMatch) {
          return { success: true, taskId, text: previewMatch[1].trim(), platform: detected, url };
        }
      }
    }

    return { success: true, taskId, text: stdout, platform: detected, url };
  } catch (e: any) {
    const stdout = e.stdout || "";
    const stderr = e.stderr || "";
    const failure = parseFailureOutput(stdout, stderr);
    const taskIdMatch = stdout.match(/\[([a-f0-9]{8})\]/) || stderr.match(/\[([a-f0-9]{8})\]/);
    const taskId = failure?.taskId || (taskIdMatch ? taskIdMatch[1] : "");

    if (taskId) {
      const transcriptPath = join(OUTPUT_DIR, `transcript_${taskId}.txt`);
      try {
        const text = await readFile(transcriptPath, "utf-8");
        return { success: true, taskId, text, platform: detected, url };
      } catch {}
    }

    return {
      success: false,
      taskId,
      error: formatPipelineError(
        e.killed || e.signal === "SIGTERM"
          ? "本地转录任务超过 15 分钟仍未完成，已自动停止。可以稍后重新转录，或换一个更短的视频链接。"
          : failure?.error || e.message.slice(0, 500),
        failure?.stage
      ),
      platform: failure?.platform || detected,
      url: failure?.url || url,
    };
  } finally {
    if (cookiesPath) {
      const { unlink } = await import("fs/promises");
      await unlink(cookiesPath).catch(() => {});
    }
  }
}

export async function transcribeFile(
  filePath: string,
  displayName?: string,
  extraEnv?: Record<string, string>
): Promise<TranscribeResult> {
  try {
    const cmd = `python "${MAIN_PY}" --file "${filePath}"`;
    const { stdout, stderr } = await execAsync(cmd, {
      timeout: 900000,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, ...extraEnv },
    });

    const taskIdMatch =
      stdout.match(/\[([a-f0-9]{8})\]/) ||
      stderr.match(/\[([a-f0-9]{8})\]/) ||
      stdout.match(/task_id.*?([a-f0-9]{8})/) ||
      stderr.match(/task_id.*?([a-f0-9]{8})/);
    const taskId = taskIdMatch ? taskIdMatch[1] : "";

    if (taskId) {
      const transcriptPath = join(OUTPUT_DIR, `transcript_${taskId}.txt`);
      try {
        const text = await readFile(transcriptPath, "utf-8");
        return { success: true, taskId, text, platform: "upload", url: displayName || basename(filePath), transcriptFile: transcriptPath };
      } catch {
        const previewMatch = stdout.match(/转录预览[\s\S]*?\n([\s\S]*?)\n\n/);
        if (previewMatch) {
          return { success: true, taskId, text: previewMatch[1].trim(), platform: "upload", url: displayName || basename(filePath) };
        }
      }
    }

    return { success: true, taskId, text: stdout, platform: "upload", url: displayName || basename(filePath) };
  } catch (e: any) {
    const stdout = e.stdout || "";
    const stderr = e.stderr || "";
    const failure = parseFailureOutput(stdout, stderr);
    const taskIdMatch = stdout.match(/\[([a-f0-9]{8})\]/) || stderr.match(/\[([a-f0-9]{8})\]/);
    const taskId = failure?.taskId || (taskIdMatch ? taskIdMatch[1] : "");

    if (taskId) {
      const transcriptPath = join(OUTPUT_DIR, `transcript_${taskId}.txt`);
      try {
        const text = await readFile(transcriptPath, "utf-8");
        return { success: true, taskId, text, platform: "upload", url: displayName || basename(filePath) };
      } catch {}
    }

    return {
      success: false,
      taskId,
      error: formatPipelineError(
        e.killed || e.signal === "SIGTERM"
          ? "本地上传转录任务超过 15 分钟仍未完成，已自动停止。可以稍后重试，或换一个更短的音视频文件。"
          : failure?.error || e.message.slice(0, 500),
        failure?.stage
      ),
      platform: "upload",
      url: displayName || basename(filePath),
    };
  }
}
