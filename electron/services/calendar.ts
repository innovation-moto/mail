import { shell } from 'electron';
import { CalendarEvent } from '../../shared/types';

function toGoogleDate(isoString: string): string {
  // YYYYMMDDTHHmmssZ 形式に変換
  return isoString.replace(/[-:]/g, '').replace(/\.\d{3}/, '').slice(0, 15) + 'Z';
}

export async function openCalendarEvent(event: CalendarEvent): Promise<void> {
  const start = toGoogleDate(event.startDate);
  const end = toGoogleDate(event.endDate);

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${start}/${end}`,
    details: event.description,
    ...(event.location ? { location: event.location } : {}),
  });

  const url = `https://calendar.google.com/calendar/render?${params.toString()}`;
  await shell.openExternal(url);
}
