import type { NextApiRequest, NextApiResponse } from 'next';
import OpenAI from 'openai';

type SearchableEmail = {
  id: string;
  from: { name: string; address: string };
  subject: string;
  date: number;
  bodyText: string;
};

type RequestBody = {
  apiKey: string;
  query: string;
  emails: SearchableEmail[];
};

type ResponseBody = { answer: string; ids: string[] } | { error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResponseBody>,
) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { apiKey, query, emails } = req.body as RequestBody;
  if (!apiKey) return res.status(400).json({ error: 'apiKey is required' });
  if (!query) return res.status(400).json({ error: 'query is required' });

  if (!emails || emails.length === 0) {
    return res.status(200).json({ answer: '検索対象のメールがありません。', ids: [] });
  }

  const targets = emails.slice(0, 200);
  const emailSummaries = targets
    .map((e, i) => `[${i}] 差出人:${e.from.name || e.from.address} 件名:${e.subject} 日時:${new Date(e.date).toLocaleDateString('ja-JP')} 本文冒頭:${(e.bodyText ?? '').slice(0, 200)}`)
    .join('\n');

  const prompt = `以下のメール一覧を参照して、ユーザーの質問に答えてください。

質問: ${query}

メール一覧:
${emailSummaries}

---
以下のJSON形式のみで回答してください（コードブロック不要）:
{"answer":"質問への回答（2〜3文）","indices":[関連するメールのインデックス番号の配列（最大10件）]}`;

  try {
    const client = new OpenAI({ apiKey });
    const result = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
    });

    const text = (result.choices[0]?.message?.content ?? '').trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as { answer: string; indices: number[] };
      const ids = (parsed.indices ?? [])
        .filter((i) => i >= 0 && i < targets.length)
        .map((i) => targets[i].id);
      return res.status(200).json({ answer: parsed.answer, ids });
    }
    return res.status(200).json({ answer: text, ids: [] });
  } catch (err) {
    console.error('[ai/smart-search]', err);
    return res.status(500).json({ error: (err as Error).message });
  }
}
