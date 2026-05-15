import type { NextApiRequest, NextApiResponse } from 'next';
import OpenAI from 'openai';
import type { CalendarEvent } from '../../../../types/shared';

type RequestBody = {
  apiKey: string;
  subject: string;
  bodyText: string;
  emailDate: number;
  fromName: string;
  fromAddress: string;
};

type ResponseBody = { event: CalendarEvent | null } | { error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResponseBody>,
) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { apiKey, subject, bodyText, emailDate, fromName, fromAddress } = req.body as RequestBody;
  if (!apiKey) return res.status(400).json({ error: 'apiKey is required' });

  try {
    const client = new OpenAI({ apiKey });
    const today = new Date(emailDate).toISOString().split('T')[0];

    const prompt = `以下のメールに予定・イベント・ミーティング・セミナー等の日程情報が含まれているか判断し、含まれていればJSON形式で返してください。

差出人名: ${fromName}
差出人メール: ${fromAddress}
件名: ${subject}
受信日: ${today}
本文:
${(bodyText ?? '').slice(0, 3000)}

---
予定が含まれる場合のみ、以下のJSON形式のみで回答してください（コードブロック不要）:
{
  "hasEvent": true,
  "companyName": "差出人の企業・組織名",
  "eventTitle": "イベントのタイトル（企業名は含めない）",
  "startDate": "YYYY-MM-DDTHH:MM:SS",
  "endDate": "YYYY-MM-DDTHH:MM:SS",
  "isOnline": true or false,
  "region": "オフラインの場合の地域名。オンラインの場合は空文字",
  "description": "予定の詳細説明"
}

予定が含まれない場合: {"hasEvent": false}

注意:
- 時刻が不明な場合は開始を09:00、終了を10:00とする
- オンライン判定: Zoom/Meet/Teams/オンライン等のキーワードがあればtrue
- regionは都市・地域名のみ（例: 東京、大阪、京都）`;

    const result = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    });

    const text = (result.choices[0]?.message?.content ?? '').trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(200).json({ event: null });

    const parsed = JSON.parse(jsonMatch[0]) as {
      hasEvent: boolean;
      companyName?: string;
      eventTitle?: string;
      startDate?: string;
      endDate?: string;
      isOnline?: boolean;
      region?: string;
      description?: string;
    };

    if (!parsed.hasEvent || !parsed.startDate) {
      return res.status(200).json({ event: null });
    }

    const place = parsed.isOnline ? 'オンライン' : (parsed.region ?? '');
    const baseTitle = [parsed.companyName, parsed.eventTitle ?? subject].filter(Boolean).join(' ');
    const title = place ? `【${place}】${baseTitle}` : baseTitle;

    return res.status(200).json({
      event: {
        title,
        startDate: parsed.startDate,
        endDate: parsed.endDate ?? parsed.startDate,
        location: place,
        isOnline: parsed.isOnline ?? false,
        description: parsed.description ?? '',
      },
    });
  } catch (err) {
    console.error('[ai/detect-event]', err);
    return res.status(500).json({ error: (err as Error).message });
  }
}
