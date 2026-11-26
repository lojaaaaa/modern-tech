export const notify = (message: string) => window.dispatchEvent(new CustomEvent('app-notice', { detail: message }));
