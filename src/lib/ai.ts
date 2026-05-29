import OpenAI from "openai";

function getClient(apiKey?: string, baseUrl?: string): OpenAI {
  return new OpenAI({
    apiKey: apiKey || process.env.DEEPSEEK_API_KEY,
    baseURL: baseUrl || process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1",
  });
}

export interface AIAnalysis {
  title: string;
  summary: string;
  keyPoints: string[];
  keywords: string[];
  suggestedTags: string[];
}

export interface AIOverrides {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  prompt?: string;
}

/**
 * Quick-analyze a note and return structured metadata that the UI can reuse.
 * Returns null if no API key is configured.
 */
export async function analyzeNote(content: string, overrides?: AIOverrides): Promise<AIAnalysis | null> {
  const apiKey = overrides?.apiKey || process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;

  const openai = getClient(apiKey, overrides?.baseUrl);
  const prompt = `你是一个温柔、可靠的笔记整理助手。请阅读下面的笔记内容，并且只返回 JSON：
{
  "title": "15字以内的标题",
  "summary": "2到3句话的简短摘要",
  "keyPoints": ["要点一", "要点二", "要点三"],
  "keywords": ["关键词1", "关键词2", "关键词3"],
  "suggestedTags": ["一级/二级", "一级/二级/三级"]
}

要求：
1. title 简洁，不要重复原文第一句
2. summary 像笔记精灵读完后的提炼，但保持克制
3. keyPoints 输出 3 到 5 条，具体，不空泛
4. suggestedTags 使用 #a/b/c 风格去掉 # 号后的路径形式
5. 只返回 JSON，不要加代码块

笔记内容：
${content.slice(0, 6000)}`;

  const resp = await openai.chat.completions.create({
    model: overrides?.model || process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    max_tokens: 600,
  });

  const text = resp.choices[0]?.message?.content;
  if (!text) return null;

  try {
    const jsonStr = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(jsonStr) as Partial<AIAnalysis>;

    return {
      title: parsed.title?.trim() || content.slice(0, 30),
      summary: parsed.summary?.trim() || "",
      keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.filter(Boolean) : [],
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords.filter(Boolean) : [],
      suggestedTags: Array.isArray(parsed.suggestedTags) ? parsed.suggestedTags.filter(Boolean) : [],
    };
  } catch {
    console.error("Failed to parse AI response:", text);
    return null;
  }
}
