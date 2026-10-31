import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
export const formatBytes = (bytes: number) =>
    bytes < 1024
        ? `${bytes} Б`
        : bytes < 1048576
          ? `${(bytes / 1024).toFixed(1)} КБ`
          : `${(bytes / 1048576).toFixed(1)} МБ`;
export const formatDate = (value: string | null) =>
    value === null
        ? '—'
        : new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));
