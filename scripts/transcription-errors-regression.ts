import { explainTranscriptionError, redactSecrets } from "../src/lib/transcription-errors";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

const signatureError = `
oss2.exceptions.SignatureDoesNotMatch: {'status': 403, 'details': {
  'Code': 'SignatureDoesNotMatch',
  'OSSAccessKeyId': 'LTAI5t7zc5d1RTNPWJf7Crk3',
  'SignatureProvided': 'hQccnYp9WQZTd1wN4a7OeULJOX4='
}}
`;

const explained = explainTranscriptionError(signatureError, "上传 OSS");
assert(explained.summary.includes("不匹配"), "SignatureDoesNotMatch should explain mismatched key pair");
assert(explained.action.includes("重新创建一对 AccessKey"), "SignatureDoesNotMatch should tell user to create a new key pair");

const redacted = redactSecrets(signatureError);
assert(!redacted.includes("LTAI5t7zc5d1RTNPWJf7Crk3"), "AccessKey ID should be redacted in diagnostic text");
assert(!redacted.includes("hQccnYp9WQZTd1wN4a7OeULJOX4="), "Signature should be redacted in diagnostic text");

const denied = explainTranscriptionError("AccessDenied: no permission", "上传 OSS");
assert(denied.summary.includes("权限不足"), "AccessDenied should explain permission issue");

const endpointMismatch = explainTranscriptionError(
  "AccessDenied {'Code': 'AccessDenied', 'Message': 'The bucket you are attempting to access must be addressed using the specified endpoint. Please send all future requests to this endpoint.', 'Bucket': 'douyin-transcribe', 'Endpoint': 'oss-cn-beijing.aliyuncs.com', 'EC': '0003-00001403'}",
  "上传 OSS",
);
assert(endpointMismatch.summary.includes("Endpoint 不匹配"), "OSS specified endpoint errors should not be reported as permission issues");
assert(endpointMismatch.action.includes("oss-cn-beijing.aliyuncs.com"), "Endpoint mismatch should include the expected endpoint");

const ffmpeg = explainTranscriptionError("ffmpeg未找到", "提取音频");
assert(ffmpeg.summary.includes("ffmpeg"), "ffmpeg error should stay actionable");

console.log("transcription error regression passed");
