import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { useAccountStore } from '../store/accountStore';
import { initDb } from '../lib/db';
import { syncPushRegistrations } from '../lib/pushRegistration';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 1000 * 30,
    },
  },
});

function AppInit({ children }: { children: React.ReactNode }) {
  const { init, accounts, getPassword, savePushToken, getPushToken } = useAccountStore();

  useEffect(() => {
    (async () => {
      await initDb();
      await init();

      // 通知権限を要求してプッシュトークンを取得・登録
      try {
        const { requestNotificationPermission, getExpoPushToken } = await import('../lib/notifications');
        const granted = await requestNotificationPermission();
        if (!granted) return;

        const token = await getExpoPushToken();
        if (!token) return;

        // トークンが変わった場合も含めて常に保存・再登録
        const prev = await getPushToken();
        await savePushToken(token);

        // トークン更新または初回登録時に全アカウントを再登録
        if (token !== prev || accounts.length > 0) {
          await syncPushRegistrations(token, accounts, getPassword);
        }
      } catch (e) {
        console.warn('[AppInit] push registration error (ignored):', e);
      }
    })();
  }, []);

  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AppInit>
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="email/[id]" options={{ headerShown: false, presentation: 'card' }} />
            <Stack.Screen name="compose" options={{ headerShown: false, presentation: 'formSheet', gestureEnabled: true }} />
            <Stack.Screen name="settings" options={{ headerShown: false, presentation: 'card' }} />
            <Stack.Screen name="setup" options={{ headerShown: false, presentation: 'modal' }} />
          </Stack>
        </AppInit>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
