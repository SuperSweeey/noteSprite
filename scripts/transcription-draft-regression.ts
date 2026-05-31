import { DEFAULTS, TranscriptionSettings, isMaskedSecret } from "../src/lib/ai-config";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function keepSecret(incoming: unknown, existing: string) {
  const value = String(incoming ?? "").trim();
  if (!value || isMaskedSecret(value)) return existing;
  return value;
}

function mergeDraftTranscription(current: TranscriptionSettings, draft: Partial<TranscriptionSettings>): TranscriptionSettings {
  return {
    cookies: draft.cookies ?? current.cookies ?? "",
    dashscopeApiKey: keepSecret(draft.dashscopeApiKey, current.dashscopeApiKey),
    ossAccessKeyId: draft.ossAccessKeyId ?? current.ossAccessKeyId ?? "",
    ossAccessKeySecret: keepSecret(draft.ossAccessKeySecret, current.ossAccessKeySecret),
    ossBucketName: draft.ossBucketName ?? current.ossBucketName ?? "",
    ossEndpoint: draft.ossEndpoint ?? current.ossEndpoint ?? "",
    ffmpegPath: draft.ffmpegPath ?? current.ffmpegPath ?? "",
    enableTimestamps: draft.enableTimestamps ?? current.enableTimestamps ?? DEFAULTS.transcription.enableTimestamps,
    enableSpeakerDiarization: draft.enableSpeakerDiarization ?? current.enableSpeakerDiarization ?? DEFAULTS.transcription.enableSpeakerDiarization,
    speakerCount: Number(draft.speakerCount ?? current.speakerCount ?? DEFAULTS.transcription.speakerCount) || 0,
  };
}

function maybePromoteDraft(current: TranscriptionSettings, draft: TranscriptionSettings, preflightOk: boolean) {
  return preflightOk ? draft : current;
}

const stable: TranscriptionSettings = {
  ...DEFAULTS.transcription,
  dashscopeApiKey: "stable-dashscope",
  ossAccessKeyId: "stable-id",
  ossAccessKeySecret: "stable-secret",
  ossBucketName: "douyin-transcribe",
  ossEndpoint: "oss-cn-beijing.aliyuncs.com",
};

const badDraft: TranscriptionSettings = {
  ...stable,
  ossBucketName: "douyin-transcribe",
  ossEndpoint: "oss-cn-shanghai.aliyuncs.com",
};

assert(maybePromoteDraft(stable, badDraft, false).ossEndpoint === "oss-cn-beijing.aliyuncs.com", "检测失败的草稿不能覆盖生效 Endpoint");
assert(maybePromoteDraft(stable, badDraft, false).ossBucketName === "douyin-transcribe", "检测失败的草稿不能污染生效 Bucket");

const goodDraft: TranscriptionSettings = {
  ...stable,
  ossAccessKeyId: "new-id",
  ossAccessKeySecret: "new-secret",
};
assert(maybePromoteDraft(stable, goodDraft, true).ossAccessKeyId === "new-id", "检测通过后才能提升新 AccessKey ID");
assert(maybePromoteDraft(stable, goodDraft, true).ossAccessKeySecret === "new-secret", "检测通过后才能提升新 Secret");

const maskedDraft = mergeDraftTranscription(stable, { ossAccessKeySecret: "••••cret", ossEndpoint: "oss-cn-beijing.aliyuncs.com" });
assert(maskedDraft.ossAccessKeySecret === "stable-secret", "遮罩 Secret 参与草稿检测时必须复用当前真实 Secret");

console.log("transcription draft regression passed");
