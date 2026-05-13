import dynamic from 'next/dynamic';

// SSR完全無効 — Electronレンダラーのみで動作
const AppShell = dynamic(
  () => import('../components/layout/AppShell').then((m) => ({ default: m.AppShell })),
  { ssr: false, loading: () => null },
);

export default function IndexPage() {
  return <AppShell />;
}
