/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production';
// Electron ビルド時のみ static export（Vercel では通常の Next.js として動作）
const isElectron = process.env.BUILD_FOR_ELECTRON === 'true';

const nextConfig = {
  ...(isProd && isElectron ? { output: 'export' } : {}),
  images: { unoptimized: true },
  assetPrefix: isProd && isElectron ? './' : '',
  // Pages Router を使用
  reactStrictMode: false,
};

export default nextConfig;
