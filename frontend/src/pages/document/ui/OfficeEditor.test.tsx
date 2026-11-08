import { render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { OfficeEditor } from './OfficeEditor';

const session = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ api: session }));

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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
