import { buildProcessingContent, isTranscriptionStale, TRANSCRIPTION_STALE_MINUTES } from "../src/lib/transcription-jobs";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

const now = new Date("2026-05-31T00:00:00.000Z");
const fresh = new Date(now.getTime() - (TRANSCRIPTION_STALE_MINUTES - 1) * 60 * 1000);
const stale = new Date(now.getTime() - (TRANSCRIPTION_STALE_MINUTES + 1) * 60 * 1000);

assert(!isTranscriptionStale(fresh, now), "未超过阈值的 processing 不能被误判失败");
assert(isTranscriptionStale(stale, now), "超过阈值的 processing 必须被判定为卡死");

const processing = buildProcessingContent("douyin", "https://example.com/video", "下载中", "abc12345");
assert(processing.includes("任务：abc12345"), "处理中内容必须写入任务令牌，避免旧任务覆盖新任务");
assert(processing.includes("超过 15 分钟"), "处理中内容必须告诉用户自动超时规则");

console.log("transcription stale regression passed");
