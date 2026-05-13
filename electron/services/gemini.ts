import OpenAI from 'openai';
import { AiTone, AiCategory, AiPriority, AiClassifyResult, AiSummarizeResult, SmartSearchResult } from '../../shared/types';
import { Email } from '../../shared/types';

let client: OpenAI | null = null;

export function initGemini(apiKey: string): void {
  client = new OpenAI({ apiKey });
}

function getClient(): OpenAI {
  if (!client) throw new Error('OpenAI APIキーが設定されていません。設定画面でAPIキーを入力してください。');
  return client;
}

async function chat(prompt: string): Promise<string> {
  const res = await getClient().chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
  });
  return res.choices[0]?.message?.content ?? '';
}

export async function generateReply(
  subject: string,
  bodyText: string,
  tone: AiTone,
): Promise<string> {
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

export async function summarizeEmail(
  subject: string,
  bodyText: string,
): Promise<AiSummarizeResult> {
  const prompt = `以下のメールを要約してください。

件名: ${subject}

本文:
${bodyText.slice(0, 4000)}

---
以下のJSON形式のみで回答してください（コードブロック不要）:
{"summary":"3〜5行の要約","actions":["要アクション項目1","要アクション項目2"]}`;

  const text = (await chat(prompt)).trim();
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]) as AiSummarizeResult;
  } catch {}
  return { summary: text, actions: [] };
}

export async function classifyEmail(
  subject: string,
  bodyText: string,
  fromAddress: string,
): Promise<AiClassifyResult> {
  const prompt = `以下のメールを分類してください。

差出人: ${fromAddress}
件名: ${subject}
本文（冒頭）: ${bodyText.slice(0, 1000)}

以下のJSON形式のみで回答してください（コードブロック不要）:
{"category":"important|task|info|newsletter|promotion|other のいずれか","priority":"high|medium|low のいずれか"}`;

  const text = (await chat(prompt)).trim();
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as { category: string; priority: string };
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

export async function smartSearch(
  query: string,
  emails: Email[],
): Promise<SmartSearchResult> {
  if (emails.length === 0) {
    return { emails: [], answer: '検索対象のメールがありません。' };
  }

  const emailSummaries = emails
    .slice(0, 100)
    .map((e, i) => `[${i}] 差出人:${e.from.name || e.from.address} 件名:${e.subject} 日時:${new Date(e.date).toLocaleDateString('ja-JP')} 本文冒頭:${e.bodyText.slice(0, 200)}`)
    .join('\n');

  const prompt = `以下のメール一覧を参照して、ユーザーの質問に答えてください。

質問: ${query}

メール一覧:
${emailSummaries}

---
以下のJSON形式のみで回答してください（コードブロック不要）:
{"answer":"質問への回答（2〜3文）","indices":[関連するメールのインデックス番号の配列（最大10件）]}`;

  const text = (await chat(prompt)).trim();
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as { answer: string; indices: number[] };
      const matchedEmails = (parsed.indices ?? [])
        .filter((i) => i >= 0 && i < emails.length)
        .map((i) => emails[i]);
      return { emails: matchedEmails, answer: parsed.answer };
    }
  } catch {}
  return { emails: [], answer: text };
}
