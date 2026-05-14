import { shell } from 'electron';
import * as http from 'http';
import * as crypto from 'crypto';

const CLIENT_ID = '263bba99-c8d1-4bfe-a2ae-9a6f9a0e0192';
const REDIRECT_URI = 'http://localhost:9876/callback';
const SCOPES = [
  'offline_access',
  'openid',
  'email',
  'profile',
  'https://outlook.office.com/IMAP.AccessAsUser.All',
  'https://outlook.office.com/SMTP.Send',
].join(' ');

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function generatePKCE() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export interface MicrosoftTokens {
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  expiresAt: number;
}

export async function startMicrosoftOAuth(): Promise<MicrosoftTokens> {
  const { verifier, challenge } = generatePKCE();
  const state = base64url(crypto.randomBytes(16));

  const authUrl = new URL('https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize');
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('scope', SCOPES);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('prompt', 'select_account');

  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url!, 'http://localhost:9876');
      if (url.pathname !== '/callback') return;

      const returnedState = url.searchParams.get('state');
      const error = url.searchParams.get('error');
      const authCode = url.searchParams.get('code');

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body><h2>認証完了！このウィンドウを閉じてください。</h2></body></html>');
      server.close();

      if (error) return reject(new Error(`OAuth error: ${error}`));
      if (returnedState !== state) return reject(new Error('State mismatch'));
      if (!authCode) return reject(new Error('No code returned'));
      resolve(authCode);
    });

    server.listen(9876, () => {
      shell.openExternal(authUrl.toString());
    });

    setTimeout(() => {
      server.close();
      reject(new Error('認証がタイムアウトしました（5分）'));
    }, 5 * 60 * 1000);
  });

  return exchangeCodeForTokens(code, verifier);
}

async function exchangeCodeForTokens(code: string, verifier: string): Promise<MicrosoftTokens> {
  const res = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
      scope: SCOPES,
    }).toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token exchange failed: ${err}`);
  }

  const data = await res.json() as {
    access_token: string;
    refresh_token: string;
    id_token?: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    idToken: data.id_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

export async function refreshMicrosoftToken(refreshToken: string): Promise<MicrosoftTokens> {
  const res = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: SCOPES,
    }).toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token refresh failed: ${err}`);
  }

  const data = await res.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

export function buildXOAuth2Token(email: string, accessToken: string): string {
  const raw = `user=${email}\x01auth=Bearer ${accessToken}\x01\x01`;
  return Buffer.from(raw).toString('base64');
}
