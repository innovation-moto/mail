import type { NextApiRequest, NextApiResponse } from 'next';
import OpenAI from 'openai';
import type { AiSummarizeResult } from '../../../../types/shared';

type RequestBody = {
  apiKey: string;
  subject: string;
  bodyText: string;
};

type ResponseBody = AiSummarizeResult | { error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResponseBody>,
) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { apiKey, subject, bodyText } = req.body as RequestBody;
  if (!apiKey) return res.status(400).json({ error: 'apiKey is required' });

  try {
    const client = new OpenAI({ apiKey });
    const prompt = `以下のメールを要約してください。

件名: ${subject ?? ''}

本文:
${(bodyText ?? '').slice(0, 4000)}

---
以下のJSON形式のみで回答してください（コードブロック不要）:
{"summary":"3〜5行の要約","actions":["要アクション項目1","要アクション項目2"]}`;

    const result = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
    });

    const text = (result.choices[0]?.message?.content ?? '').trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as AiSummarizeResult;
      return res.status(200).json(parsed);
    }
    return res.status(200).json({ summary: text, actions: [] });
  } catch (err) {
    console.error('[ai/summarize]', err);
    return res.status(500).json({ error: (err as Error).message });
  }
}
