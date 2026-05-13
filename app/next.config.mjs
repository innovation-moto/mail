/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production';

const nextConfig = {
  ...(isProd ? { output: 'export' } : {}),
  images: { unoptimized: true },
  assetPrefix: isProd ? './' : '',
  // Pages Router を使用
  reactStrictMode: false,
};

export default nextConfig;
