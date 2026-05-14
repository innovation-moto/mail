import OpenAI from 'openai';
import { AiTone, AiCategory, AiPriority, AiClassifyResult, AiSummarizeResult, CalendarEvent } from '@/types/shared';

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OpenAI APIキーが設定されていません。Vercelの環境変数にOPENAI_API_KEYを設定してください。');
  return new OpenAI({ apiKey });
}

async function chat(prompt: string): Promise<string> {
  const res = await getClient().chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
  });
  return res.choices[0]?.message?.content ?? '';
}

export async function generateReply(subject: string, bodyText: string, tone: AiTone): Promise<string> {
  const toneMap: Record<AiTone, string> = {
    polite: '丁寧で礼儀正しいビジネストーン',
    casual: 'カジュアルで親しみやすいトーン',
    brief: '簡潔で要点のみを伝えるトーン',
  };
  const prompt = `以下のメールに対する返信文を「${toneMap[tone]}」で生成してください。

件名: ${subject}

本文:
${bodyText.slice(0, 3000)}

---
返信文のみを出力してください（宛名・挨拶・本文・締め・署名の構成で）。余分な説明は不要です。`;
  return chat(prompt);
}

export async function summarizeEmail(subject: string, bodyText: string): Promise<AiSummarizeResult> {
  const prompt = `以下のメールを要約してください。

件名: ${subject}

本文:
${bodyText.slice(0, 4000)}

---
以下のJSON形式のみで回答してください（コードブロック不要）:
{"summary":"3〜5行の要約","actions":["要アクション項目1","要アクション項目2"]}`;
  const text = (await chat(prompt)).trim();
  try {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]) as AiSummarizeResult;
  } catch {}
  return { summary: text, actions: [] };
}

export async function classifyEmail(subject: string, bodyText: string, fromAddress: string): Promise<AiClassifyResult> {
  const prompt = `以下のメールを分類してください。

差出人: ${fromAddress}
件名: ${subject}
本文（冒頭）: ${bodyText.slice(0, 1000)}

以下のJSON形式のみで回答してください（コードブロック不要）:
{"category":"important|task|info|newsletter|promotion|other のいずれか","priority":"high|medium|low のいずれか"}`;
  const text = (await chat(prompt)).trim();
  try {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      const parsed = JSON.parse(m[0]) as { category: string; priority: string };
      const validCategories: AiCategory[] = ['important', 'task', 'info', 'newsletter', 'promotion', 'other'];
      const validPriorities: AiPriority[] = ['high', 'medium', 'low'];
      return {
        category: validCategories.includes(parsed.category as AiCategory) ? (parsed.category as AiCategory) : 'other',
        priority: validPriorities.includes(parsed.priority as AiPriority) ? (parsed.priority as AiPriority) : 'medium',
      };
    }
  } catch {}
  return { category: 'other', priority: 'medium' };
}

export async function detectCalendarEvent(
  subject: string, bodyText: string, emailDate: number, fromName: string, fromAddress: string,
): Promise<CalendarEvent | null> {
  const today = new Date(emailDate).toISOString().split('T')[0];
  const prompt = `以下のメールに予定・イベント・ミーティング・セミナー等の日程情報が含まれているか判断し、含まれていればJSON形式で返してください。

差出人名: ${fromName}
差出人メール: ${fromAddress}
件名: ${subject}
受信日: ${today}
本文:
${bodyText.slice(0, 3000)}

---
予定が含まれる場合のみ、以下のJSON形式のみで回答してください（コードブロック不要）:
{"hasEvent":true,"companyName":"企業名","eventTitle":"タイトル","startDate":"YYYY-MM-DDTHH:MM:SS","endDate":"YYYY-MM-DDTHH:MM:SS","isOnline":true,"region":"地域名","description":"詳細"}

予定が含まれない場合: {"hasEvent": false}`;
  const text = (await chat(prompt)).trim();
  try {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]) as {
      hasEvent: boolean; companyName?: string; eventTitle?: string;
      startDate?: string; endDate?: string; isOnline?: boolean; region?: string; description?: string;
    };
    if (!parsed.hasEvent || !parsed.startDate) return null;
    const place = parsed.isOnline ? 'オンライン' : (parsed.region || '');
    const baseTitle = [parsed.companyName, parsed.eventTitle ?? subject].filter(Boolean).join(' ');
    return {
      title: place ? `【${place}】${baseTitle}` : baseTitle,
      startDate: parsed.startDate,
      endDate: parsed.endDate ?? parsed.startDate,
      location: place,
      isOnline: parsed.isOnline ?? false,
      description: parsed.description ?? '',
    };
  } catch {}
  return null;
}
