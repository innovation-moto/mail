import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { formatDistanceToNow, format, isToday, isYesterday, isThisYear } from 'date-fns';
import { ja } from 'date-fns/locale';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatEmailDate(timestamp: number): string {
  const date = new Date(timestamp);
  if (isToday(date)) return format(date, 'HH:mm');
  if (isYesterday(date)) return '昨日';
  if (isThisYear(date)) return format(date, 'M/d');
  return format(date, 'yyyy/M/d');
}

export function formatFullDate(timestamp: number): string {
  return format(new Date(timestamp), 'yyyy年M月d日(E) HH:mm', { locale: ja });
}

export function truncate(str: string, max: number): string {
  return str.length <= max ? str : str.slice(0, max) + '…';
}

export function getInitials(name: string, email: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    if (name[0]) return name[0].toUpperCase();
  }
  return (email?.[0] ?? '?').toUpperCase();
}

export function getAvatarColor(email: string): string {
  const colors = [
    'bg-red-500', 'bg-orange-500', 'bg-amber-500', 'bg-yellow-500',
    'bg-lime-500', 'bg-green-500', 'bg-emerald-500', 'bg-teal-500',
    'bg-cyan-500', 'bg-sky-500', 'bg-blue-500', 'bg-indigo-500',
    'bg-violet-500', 'bg-purple-500', 'bg-fuchsia-500', 'bg-pink-500',
  ];
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = email.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

export const CATEGORY_LABELS: Record<string, string> = {
  important: '重要',
  task: 'タスク',
  info: '情報',
  newsletter: 'ニュースレター',
  promotion: 'プロモーション',
  other: 'その他',
};

export const PRIORITY_LABELS: Record<string, string> = {
  high: '高',
  medium: '中',
  low: '低',
};

export const PRIORITY_COLORS: Record<string, string> = {
  high: 'text-red-500',
  medium: 'text-yellow-500',
  low: 'text-green-500',
};
