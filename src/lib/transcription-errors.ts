export interface FriendlyTranscriptionError {
  summary: string;
  detail: string;
  action: string;
}

function compact(text: string) {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function redactSecrets(text: string) {
  return compact(text)
    .replace(/(OSSAccessKeyId['"]?\s*[:=]\s*['"]?)([A-Za-z0-9]{8})[A-Za-z0-9]+/g, "$1$2****")
    .replace(/(AccessKey ID[:：\s]+)([A-Za-z0-9]{8})[A-Za-z0-9]+/gi, "$1$2****")
    .replace(/(api[_ -]?key[:：\s'\"]+)(sk-[A-Za-z0-9_-]{6})[A-Za-z0-9_-]+/gi, "$1$2****")
    .replace(/(SignatureProvided['"]?\s*[:=]\s*['"]?)[A-Za-z0-9/+=]+/g, "$1****");
}

export function explainTranscriptionError(raw: string, stage?: string): FriendlyTranscriptionError {
  const text = redactSecrets(raw || "");
  const stageText = stage ? `阶段：${stage}` : "";

  if (/must be addressed using the specified endpoint|0003-00001403|specified endpoint/i.test(text)) {
    const bucket = text.match(/'Bucket':\s*'([^']+)'|<Bucket>([^<]+)<\/Bucket>/i);
    const endpoint = text.match(/'Endpoint':\s*'([^']+)'|<Endpoint>([^<]+)<\/Endpoint>/i);
    const bucketName = bucket?.[1] || bucket?.[2] || "当前 Bucket";
    const expectedEndpoint = endpoint?.[1] || endpoint?.[2] || "Bucket 所在地域的 Endpoint";
    return {
      summary: "OSS Bucket 和 Endpoint 不匹配",
      detail: [stageText, `${bucketName} 不在当前填写的 Endpoint 地域。OSS 要求这个 Bucket 使用 ${expectedEndpoint}。`].filter(Boolean).join("\n"),
      action: `把设置页里的 OSS Endpoint 改成 ${expectedEndpoint}，或者改用当前 Endpoint 地域下真实存在的 Bucket。Bucket 和 Endpoint 必须来自同一个地域。`,
    };
  }

  if (/SignatureDoesNotMatch/i.test(text)) {
    return {
      summary: "OSS AccessKey ID 和 Secret 不匹配",
      detail: [stageText, "阿里云能识别这个 AccessKey ID，但用对应 Secret 计算出来的签名对不上。最常见原因是 ID 和 Secret 不是同一对，或 Secret 复制时多了空格/换行。"].filter(Boolean).join("\n"),
      action: "去 RAM 用户的「凭证管理」重新创建一对 AccessKey，把同一次创建得到的 ID 和 Secret 一起填回 NoteSprite。旧 Secret 看不到就不要猜，直接删旧换新。",
    };
  }

  if (/InvalidAccessKeyId|AccessKeyId.*not exist|NoSuchAccessKey/i.test(text)) {
    return {
      summary: "OSS AccessKey ID 不存在或已禁用",
      detail: [stageText, "当前填写的 OSS AccessKey ID 在阿里云 RAM 中找不到，或者已经被禁用/删除。"].filter(Boolean).join("\n"),
      action: "确认设置页里的 OSS AccessKey ID 来自当前 RAM 用户，状态为启用；不确定就重新创建一对 AccessKey。",
    };
  }

  if (/AccessDenied/i.test(text)) {
    return {
      summary: "OSS 上传权限不足",
      detail: [stageText, "AccessKey 有效，但这个 RAM 用户没有对当前 Bucket 执行 PutObject/GetObject/DeleteObject 的权限。"].filter(Boolean).join("\n"),
      action: "个人使用可先给 RAM 用户 AliyunOSSFullAccess；之后再收紧到当前 Bucket 的 PutObject、GetObject、DeleteObject。",
    };
  }

  if (/NoSuchBucket/i.test(text)) {
    return {
      summary: "OSS Bucket 名称或地域不对",
      detail: [stageText, "当前 Bucket 不存在，或者 Endpoint 指向的地域和 Bucket 实际地域不一致。"].filter(Boolean).join("\n"),
      action: "确认 Bucket 名称，例如 douyin-transcribe；如果地域是华北 2（北京），Endpoint 应填 oss-cn-beijing.aliyuncs.com。",
    };
  }

  if (/InvalidApiKey|Invalid API-key|invalid_api_key|Authentication Fails|HTTP 401/i.test(text)) {
    return {
      summary: "DashScope API Key 无效",
      detail: [stageText, "语音转文字用的是阿里云百炼/DashScope API Key，不是 DeepSeek Key，也不是 OSS AccessKey。"].filter(Boolean).join("\n"),
      action: "在设置页「转录」里填写 DashScope API Key；模型设置里的 DeepSeek Key 不会用于转录。",
    };
  }

  if (/ffmpeg/i.test(text)) {
    return {
      summary: "ffmpeg 不可用",
      detail: [stageText, text.slice(0, 360)].filter(Boolean).join("\n"),
      action: "在设置页填写 ffmpeg.exe 的完整路径，或把 ffmpeg 加到系统 PATH 后重新检测。",
    };
  }

  if (/cookies|登录|login|CAPTCHA|CAPTURE_FAILED/i.test(text)) {
    return {
      summary: "平台下载需要更新 Cookie",
      detail: [stageText, "视频平台拒绝了下载请求，常见于登录态过期、风控或需要 Cookie。"].filter(Boolean).join("\n"),
      action: "在浏览器重新登录对应平台，导出最新 Cookie，填到设置页「转录」后重试。",
    };
  }

  return {
    summary: "转录管线失败",
    detail: [stageText, text.slice(0, 500)].filter(Boolean).join("\n"),
    action: "先点设置页「检测管线」，按失败项修复；如果仍失败，把这条错误发给我继续查。",
  };
}

export function formatFriendlyTranscriptionError(raw: string, stage?: string) {
  const explained = explainTranscriptionError(raw, stage);
  return [
    explained.summary,
    explained.detail,
    `解决：${explained.action}`,
  ].filter(Boolean).join("\n");
}
