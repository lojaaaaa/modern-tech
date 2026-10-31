import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { TextReader } from './index';
it('captures exact offsets and quote across unicode text for a contextual comment', () => {
    const onComment = vi.fn();
    render(<TextReader text={'Начало 😀\nВажный фрагмент\nКонец'} canComment target={null} onComment={onComment} />);
    const content = screen.getByText(/Начало/);
    const node = content.firstChild!;
    const range = document.createRange();
    range.setStart(node, 10);
    range.setEnd(node, 25);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent.mouseUp(content);
    fireEvent.click(screen.getByRole('button', { name: 'Комментировать выделение' }));
    expect(onComment).toHaveBeenCalledWith({ start: 10, end: 25, quote: 'Важный фрагмент' });
});
it('scrolls to the exact highlighted quote rather than another identical phrase', () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    render(
        <TextReader
            text="фраза и фраза"
            canComment={false}
            target={{ start: 8, end: 13, quote: 'фраза', key: 'comment' }}
            onComment={vi.fn()}
        />
    );
    expect(document.querySelector('mark')?.textContent).toBe('фраза');
    expect(scroll).toHaveBeenCalledOnce();
    expect(document.activeElement?.tagName).toBe('MARK');
});
