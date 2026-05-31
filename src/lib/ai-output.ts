export function cleanAIOutput(value: unknown): string {
  let text = String(value || "");
  if (!text) return "";

  text = text.replace(/<think[\s\S]*?<\/think>/gi, "");
  text = text.replace(/<thinking[\s\S]*?<\/thinking>/gi, "");
  text = text.replace(/```(?:reasoning|thinking|思考|推理)[\s\S]*?```/gi, "");
  text = text.replace(/^\s*(?:思考过程|推理过程|内部思考|我的思考|Thought process|Reasoning)\s*[:：][\s\S]*?(?=\n\s*(?:最终回答|回答|结论|正文)\s*[:：]|\n#{1,6}\s+|$)/gim, "");
  text = text.replace(/^\s*(?:最终回答|回答|正文)\s*[:：]\s*/gim, "");
  text = text.replace(/\n{3,}/g, "\n\n").trim();

  return text;
}

export function modelWasTruncated(choice: any): boolean {
  const reason = String(choice?.finish_reason || choice?.finishReason || "").toLowerCase();
  return reason === "length" || reason === "max_tokens" || reason === "content_filter_length";
}

export function pickAssistantContent(choice: any): string {
  const message = choice?.message || {};
  return cleanAIOutput(message.content || choice?.text || "");
}

export function looksLikeTruncatedAIOutput(value: unknown): boolean {
  const text = cleanAIOutput(value);
  if (!text) return false;
  if (/这次(?:回答|解读).*长度上限截断|回答被模型长度上限截断|解读被模型长度上限截断/.test(text)) return true;
  if (/[#*_`>：:，,、；;（(]$/.test(text.trim())) return true;
  if (/(第[一二三四五六七八九十]步|[一二三四五六七八九十]、|[0-9]+[.、])\s*$/.test(text.trim())) return true;
  const fenceCount = (text.match(/```/g) || []).length;
  if (fenceCount % 2 === 1) return true;
  const boldCount = (text.match(/\*\*/g) || []).length;
  if (boldCount % 2 === 1) return true;
  const quoteCount = (text.match(/[“”]/g) || []).length;
  if (quoteCount % 2 === 1) return true;
  return false;
}
