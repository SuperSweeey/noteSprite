import { exec } from "child_process";
import { readFile } from "fs/promises";
import { join } from "path";
import { promisify } from "util";

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

/** Extract a clean URL from pasted share text (e.g. douyin/bilibili share messages) */
export function extractUrl(text: string): { url: string; title?: string } {
  // Try to find a URL in the text
  const urlMatch = text.match(/https?:\/\/[^\s]+/);
  const cleanUrl = urlMatch ? urlMatch[0].replace(/[。，！？、…]+$/, "") : text.trim();

  // Try to extract a title from share text like 【标题】 or 《标题》
  const titleMatch = text.match(/【(.+?)】/) || text.match(/《(.+?)》/);
  const title = titleMatch ? titleMatch[1] : undefined;

  return { url: cleanUrl, title };
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
    return { success: false, taskId: "", error: `不支持的链接类型，目前支持：抖音、B站、YouTube、小红书` };
  }

  // Write cookies to temp file if provided
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
    console.log(`[Transcribe] Running: ${cmd}`);

    const env = { ...process.env, ...extraEnv };
    if (cookiesPath) env.COOKIES_PATH = cookiesPath;

    const { stdout, stderr } = await execAsync(cmd, {
      timeout: 300000,
      maxBuffer: 1024 * 1024,
      env,
    });

    console.log("[Transcribe] stdout:", stdout.slice(0, 300));
    if (stderr) console.log("[Transcribe] stderr:", stderr.slice(0, 300));

    // Parse task ID from output
    const taskIdMatch =
      stdout.match(/\[([a-f0-9]{8})\]/) ||
      stderr.match(/\[([a-f0-9]{8})\]/) ||
      stdout.match(/task_id.*?([a-f0-9]{8})/) ||
      stderr.match(/task_id.*?([a-f0-9]{8})/);

    const taskId = taskIdMatch ? taskIdMatch[1] : "";

    // Read the transcript file
    if (taskId) {
      const transcriptPath = join(OUTPUT_DIR, `transcript_${taskId}.txt`);
      try {
        const text = await readFile(transcriptPath, "utf-8");
        return {
          success: true,
          taskId,
          text,
          platform: detected,
          url,
          transcriptFile: transcriptPath,
        };
      } catch {
        // Try to extract transcript from stdout
        const previewMatch = stdout.match(/转录预览[\s\S]*?\n([\s\S]*?)\n\n/);
        if (previewMatch) {
          return {
            success: true,
            taskId,
            text: previewMatch[1].trim(),
            platform: detected,
            url,
          };
        }
      }
    }

    return { success: true, taskId, text: stdout, platform: detected, url };
  } catch (e: any) {
    console.error("[Transcribe] Error:", e.message);
    // Check if there's partial output
    const stdout = e.stdout || "";
    const taskIdMatch = stdout.match(/\[([a-f0-9]{8})\]/);
    const taskId = taskIdMatch ? taskIdMatch[1] : "";

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
      error: e.message.slice(0, 500),
      platform: detected,
      url,
    };
  } finally {
    // Clean up temp cookies file
    if (cookiesPath) {
      const { unlink } = await import("fs/promises");
      await unlink(cookiesPath).catch(() => {});
    }
  }
}
