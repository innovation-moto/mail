'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (mode === 'signup') {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) { setError(error.message); setLoading(false); return; }
      setDone(true);
      setLoading(false);
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setError(error.message); setLoading(false); return; }
    window.location.href = '/';
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-8 w-full max-w-sm">
        <div className="mb-8 text-center">
          <img src="logo.png" alt="IM Mail" className="h-8 mx-auto mb-4 dark:hidden" />
          <img src="logo_white.png" alt="IM Mail" className="h-8 mx-auto mb-4 hidden dark:block" />
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">
            {mode === 'login' ? 'ログイン' : 'アカウント作成'}
          </h1>
        </div>

        {done ? (
          <div className="text-center text-green-600 dark:text-green-400">
            <p>確認メールを送信しました。</p>
            <p className="text-sm mt-1">メール内のリンクをクリックしてください。</p>
            <button onClick={() => setMode('login')} className="mt-4 text-blue-600 underline text-sm">
              ログインへ戻る
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">メールアドレス</label>
              <input
                type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">パスワード</label>
              <input
                type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <button
              type="submit" disabled={loading}
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              {loading ? '処理中...' : mode === 'login' ? 'ログイン' : 'アカウント作成'}
            </button>
            <p className="text-center text-sm text-gray-500">
              {mode === 'login' ? (
                <>アカウントがない方は <button type="button" onClick={() => setMode('signup')} className="text-blue-600 underline">新規登録</button></>
              ) : (
                <>既にアカウントをお持ちの方は <button type="button" onClick={() => setMode('login')} className="text-blue-600 underline">ログイン</button></>
              )}
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
