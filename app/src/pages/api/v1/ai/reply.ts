import type { NextApiRequest, NextApiResponse } from 'next';
import OpenAI from 'openai';
import type { AiTone } from '../../../../types/shared';

type RequestBody = {
  apiKey: string;
  subject: string;
  bodyText: string;
  tone: AiTone;
};

type ResponseBody = { reply: string } | { error: string };

const TONE_MAP: Record<AiTone, string> = {
  polite: '丁寧で礼儀正しいビジネストーン',
  casual: 'カジュアルで親しみやすいトーン',
  brief: '簡潔で要点のみを伝えるトーン',
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResponseBody>,
) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { apiKey, subject, bodyText, tone = 'polite' } = req.body as RequestBody;
  if (!apiKey) return res.status(400).json({ error: 'apiKey is required' });

  try {
    const client = new OpenAI({ apiKey });
    const prompt = `以下のメールに対する返信文を「${TONE_MAP[tone] ?? TONE_MAP.polite}」で生成してください。

件名: ${subject ?? ''}

本文:
${(bodyText ?? '').slice(0, 3000)}

---
返信文のみを出力してください（宛名・挨拶・本文・締め・署名の構成で）。余分な説明は不要です。`;

    const result = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
    });

    const reply = result.choices[0]?.message?.content ?? '';
    return res.status(200).json({ reply });
  } catch (err) {
    console.error('[ai/reply]', err);
    return res.status(500).json({ error: (err as Error).message });
  }
}
