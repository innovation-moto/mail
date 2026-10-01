/**
 * Gmail OAuth リフレッシュトークン取得スクリプト
 * 使い方: node scripts/get-gmail-token.mjs
 */
import * as readline from 'readline';
import * as https from 'https';
import * as http from 'http';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(res => rl.question(q, res));

const REDIRECT_URI = 'http://localhost:9999/callback';

async function main() {
  console.log('\n=== Gmail リフレッシュトークン取得 ===\n');

  const clientId     = await ask('クライアントID: ');
  const clientSecret = await ask('クライアントシークレット: ');

  const authUrl =
    `https://accounts.google.com/o/oauth2/v2/auth` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent('https://www.googleapis.com/auth/gmail.readonly')}` +
    `&access_type=offline` +
    `&prompt=consent`;

  console.log('\n以下のURLをブラウザで開いて認証してください:\n');
  console.log(authUrl);
  console.log('\n認証後、自動でコードを取得します...\n');

  // ローカルサーバーでコードを受け取る
  const code = await new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost:9999');
      const code = url.searchParams.get('code');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h2>認証完了！このタブを閉じてターミナルに戻ってください。</h2>');
      server.close();
      resolve(code);
    });
    server.listen(9999);
  });

  // トークン取得
  const postData = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
  }).toString();

  const token = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });

  if (token.error) {
    console.error('\nエラー:', token.error_description ?? token.error);
    rl.close();
    return;
  }

  console.log('\n=== 取得完了 ===');
  console.log('以下の3つをSupabaseのSecretsに設定してください:\n');
  console.log(`GMAIL_CLIENT_ID     = ${clientId}`);
  console.log(`GMAIL_CLIENT_SECRET = ${clientSecret}`);
  console.log(`GMAIL_REFRESH_TOKEN = ${token.refresh_token}`);
  rl.close();
}

main().catch(e => { console.error(e); rl.close(); });
