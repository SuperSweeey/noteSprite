import OpenAI from "openai";

function getClient(apiKey?: string, baseUrl?: string): OpenAI {
  return new OpenAI({
    apiKey: apiKey || process.env.DEEPSEEK_API_KEY,
    baseURL: baseUrl || process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1",
  });
}

export interface AIAnalysis {
  title: string;
  keywords: string[];
  suggestedTags: string[];
}

export interface AIOverrides {
  apiKey?: string; baseUrl?: string; model?: string; prompt?: string;
}

/**
 * Quick-analyze a note: generate title + tags (+ keywords).
 * Summary and key points are done by the report/spirit endpoint (精灵展读).
 * Returns null if no API key is configured.
 */
export async function analyzeNote(content: string, overrides?: AIOverrides): Promise<AIAnalysis | null> {
  const apiKey = overrides?.apiKey || process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;

  const openai = getClient(apiKey, overrides?.baseUrl);
  const prompt = `你是一个知识管理助手。分析以下用户笔记内容，返回JSON。

{
  "title": "15字以内的标题",
  "keywords": ["关键词1", "关键词2", "关键词3"],
  "suggestedTags": ["一级/二级", "一级/二级/三级"]
}

## 笔记内容：
${content.slice(0, 6000)}

只返回JSON，不要任何其他文字。`;

  const resp = await openai.chat.completions.create({
    model: overrides?.model || process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    max_tokens: 400,
  });

  const text = resp.choices[0]?.message?.content;
  if (!text) return null;

  try {
    const jsonStr = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    return JSON.parse(jsonStr) as AIAnalysis;
  } catch {
    console.error("Failed to parse AI response:", text);
    return null;
  }
}
