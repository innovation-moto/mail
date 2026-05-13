'use client';
import { create } from 'zustand';
import { Email } from '@shared/types';

type Theme = 'light' | 'dark' | 'system';
type Modal = 'compose' | 'accountSetup' | 'settings' | null;

interface ComposeState {
  replyTo?: Email;
  forwardFrom?: Email;
}

interface UIState {
  theme: Theme;
  modal: Modal;
  composeState: ComposeState;
  sidebarCollapsed: boolean;
  isLoading: boolean;

  setTheme: (theme: Theme) => void;
  openCompose: (state?: ComposeState) => void;
  openAccountSetup: () => void;
  openSettings: () => void;
  closeModal: () => void;
  toggleSidebar: () => void;
  setLoading: (loading: boolean) => void;
  applyTheme: (theme: Theme) => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  theme: 'system',
  modal: null,
  composeState: {},
  sidebarCollapsed: false,
  isLoading: false,

  setTheme: (theme) => {
    set({ theme });
    get().applyTheme(theme);
  },

  applyTheme: (theme) => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else if (theme === 'light') {
      root.classList.remove('dark');
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.classList.toggle('dark', prefersDark);
    }
  },

  openCompose: (state = {}) => set({ modal: 'compose', composeState: state }),
  openAccountSetup: () => set({ modal: 'accountSetup' }),
  openSettings: () => set({ modal: 'settings' }),
  closeModal: () => set({ modal: null, composeState: {} }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setLoading: (isLoading) => set({ isLoading }),
}));
