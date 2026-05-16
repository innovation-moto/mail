import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// フォアグラウンドでも通知を表示する設定
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/** 通知権限を要求（初回起動時） */
export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

/** 新着メール通知を表示 */
export async function showNewMailNotification(
  count: number,
  from: string,
  subject: string,
): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: count === 1 ? `新着メール: ${from}` : `新着メール ${count}件`,
      body: subject || '（件名なし）',
      sound: true,
    },
    trigger: null, // 即時表示
  });
}

/** バッジ数を更新 */
export async function setBadgeCount(count: number): Promise<void> {
  await Notifications.setBadgeCountAsync(count);
}
