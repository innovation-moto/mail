import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { useAccountStore } from '../store/accountStore';
import { initDb } from '../lib/db';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 1000 * 30,
    },
  },
});

function AppInit({ children }: { children: React.ReactNode }) {
  const init = useAccountStore((s) => s.init);

  useEffect(() => {
    (async () => {
      await initDb();
      await init();
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
            <Stack.Screen name="compose" options={{ headerShown: false, presentation: 'card' }} />
            <Stack.Screen name="settings" options={{ headerShown: false, presentation: 'card' }} />
            <Stack.Screen name="setup" options={{ headerShown: false, presentation: 'modal' }} />
          </Stack>
        </AppInit>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
