// This file intentionally redirects to the tab-based settings
// The settings screen is implemented at app/(tabs)/settings.tsx
// This file exists for direct deep-link access to /settings route

import { Redirect } from 'expo-router';

export default function SettingsRedirect() {
  return <Redirect href="/(tabs)/settings" />;
}
