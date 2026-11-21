import { create } from 'zustand';
import { persist } from 'zustand/middleware';
export const useTheme = create<{ isDark: boolean; toggle: () => void }>()(
    persist((set) => ({ isDark: false, toggle: () => set((state) => ({ isDark: !state.isDark })) }), {
        name: 'modern-tech-theme',
        version: 1,
        partialize: ({ isDark }) => ({ isDark }),
        migrate: (state) => ({
            isDark: typeof state === 'object' && state !== null && 'dark' in state && state.dark === true,
        }),
    })
);
