export const isElectron = typeof window !== 'undefined' && 'electronAPI' in window;

export function getAPI() {
  if (!isElectron) throw new Error('Electronの外では使用できません');
  return window.electronAPI;
}

export const api = {
  get accounts() { return getAPI().accounts; },
  get mail() { return getAPI().mail; },
  get ai() { return getAPI().ai; },
  get blocklist() { return getAPI().blocklist; },
  get settings() { return getAPI().settings; },
  get filters() { return getAPI().filters; },
  get folders() { return getAPI().folders; },
  on(channel: string, callback: (...args: unknown[]) => void) {
    return getAPI().on(channel, callback);
  },
};
