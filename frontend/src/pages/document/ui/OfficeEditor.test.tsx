import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { OfficeEditor } from './OfficeEditor';

const session = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ api: session }));

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

it('offers a retry when the editor never reports readiness', async () => {
    vi.useFakeTimers();
    const destroyEditor = vi.fn();
    class DocEditor {
        destroyEditor = destroyEditor;
    }
    vi.stubGlobal('DocsAPI', { DocEditor });
    session.mockResolvedValue({ documentServerUrl: 'http://localhost:8895', config: { documentType: 'word' } });
    const append = document.head.appendChild.bind(document.head);
    vi.spyOn(document.head, 'appendChild').mockImplementation((element) => {
        const result = append(element);
        queueMicrotask(() => element.dispatchEvent(new Event('load')));
        return result;
    });
    render(<OfficeEditor documentId="doc-2" />);
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });
    await act(async () => {
        await vi.advanceTimersByTimeAsync(30000);
    });
    expect(screen.getByText(/Редактор не ответил/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Повторить подключение' })).toBeInTheDocument();
});

it('opens the editor and destroys it when the document workspace closes', async () => {
    const destroyEditor = vi.fn();
    const create = vi.fn();
    class DocEditor {
        constructor() {
            create();
        }
        destroyEditor = destroyEditor;
    }
    vi.stubGlobal('DocsAPI', { DocEditor });
    session.mockResolvedValue({ documentServerUrl: 'http://localhost:8895', config: { documentType: 'word' } });
    const append = document.head.appendChild.bind(document.head);
    vi.spyOn(document.head, 'appendChild').mockImplementation((element) => {
        const result = append(element);
        queueMicrotask(() => element.dispatchEvent(new Event('load')));
        return result;
    });
    const { unmount } = render(<OfficeEditor documentId="doc-1" />);
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(session).toHaveBeenCalledWith(
        '/documents/doc-1/editor/session',
        expect.objectContaining({ method: 'POST' })
    );
    unmount();
    expect(destroyEditor).toHaveBeenCalledOnce();
});
