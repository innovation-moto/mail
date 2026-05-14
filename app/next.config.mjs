/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production';
// Vercel環境では静的書き出しを無効にしてAPIルートを有効にする
const isVercel = process.env.VERCEL === '1';
const isElectronBuild = isProd && !isVercel;

const nextConfig = {
  ...(isElectronBuild ? { output: 'export' } : {}),
  images: { unoptimized: true },
  assetPrefix: isElectronBuild ? './' : '',
  // Pages Router を使用
  reactStrictMode: false,
};

export default nextConfig;
