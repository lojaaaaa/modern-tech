import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(cleanup);

if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = new Proxy(() => undefined, {
        apply: (_target, dialog: HTMLDialogElement) => dialog.setAttribute('open', ''),
    });
    HTMLDialogElement.prototype.close = new Proxy(() => undefined, {
        apply: (_target, dialog: HTMLDialogElement) => dialog.removeAttribute('open'),
    });
}
