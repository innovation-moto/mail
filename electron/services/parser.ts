import PostalMime from 'postal-mime';
import sanitizeHtml from 'sanitize-html';
import { EmailAddress } from '../../shared/types';
import { extractMessageIds } from '../utils/thread';

export interface ParsedEmail {
  messageId: string;
  inReplyTo: string[];   // In-Reply-To の Message-ID（<> なし）
  references: string[];  // References の Message-ID（古い順、<> なし）
  from: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  replyToAddress: string; // Reply-To ヘッダーの最初のアドレス
  subject: string;
  bodyText: string;
  bodyHtml: string;
  date: number;
  hasAttachments: boolean;
  attachments: Array<{ filename: string; contentType: string; size: number; content: ArrayBuffer }>;
}

function normalizeAddress(addr: { name?: string; address?: string } | undefined): EmailAddress {
  return {
    name: addr?.name ?? '',
    address: addr?.address ?? '',
  };
}

export async function parseRawEmail(source: Uint8Array | Buffer | string): Promise<ParsedEmail> {
  const parser = new PostalMime();
  const parsed = await parser.parse(source as unknown as ArrayBuffer);

  const bodyHtml = parsed.html
    ? sanitizeHtml(parsed.html, {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat([
          'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
          'font', 'center', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        ]),
        allowedAttributes: {
          ...sanitizeHtml.defaults.allowedAttributes,
          '*': ['style', 'class', 'align', 'valign', 'bgcolor', 'color', 'width', 'height'],
          'img': ['src', 'alt', 'width', 'height'],
          'a': ['href', 'name', 'target'],
        },
        allowedSchemes: ['http', 'https', 'mailto', 'cid'],
      })
    : '';

  const bodyText = parsed.text ?? bodyHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  const attachments = (parsed.attachments ?? [])
    .filter((a) => a.disposition === 'attachment' || (!a.disposition && a.filename))
    .map((a) => {
      const content = a.content as ArrayBuffer | { byteLength: number };
      const size = typeof content === 'object' && 'byteLength' in content ? content.byteLength : 0;
      return {
        filename: a.filename ?? 'attachment',
        contentType: a.mimeType ?? 'application/octet-stream',
        size,
        content: a.content as ArrayBuffer,
      };
    });

  const replyToList = (parsed as any).replyTo ?? [];
  const replyToAddress = replyToList[0]?.address ?? '';

  return {
    messageId: parsed.messageId ?? '',
    inReplyTo: extractMessageIds(parsed.inReplyTo),
    references: extractMessageIds(parsed.references),
    from: normalizeAddress(parsed.from),
    to: (parsed.to ?? []).map(normalizeAddress),
    cc: (parsed.cc ?? []).map(normalizeAddress),
    replyToAddress,
    subject: parsed.subject ?? '(件名なし)',
    bodyText,
    bodyHtml,
    date: parsed.date ? new Date(parsed.date).getTime() : Date.now(),
    hasAttachments: attachments.length > 0,
    attachments,
  };
}
