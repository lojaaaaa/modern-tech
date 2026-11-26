import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DateRangePicker } from './date-range-picker';
import { Pagination } from './pagination';

it('prevents choosing dates outside the opposite boundary', () => {
    const change = vi.fn();
    render(
        <DateRangePicker label="Создание" from="2026-11-10" to="2026-11-20" onFromChange={change} onToChange={change} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Создание, по' }));
    expect(screen.getByRole('button', { name: '9' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '10' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '9' }));
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '15' }));
    expect(change).toHaveBeenCalledWith('2026-11-15');
});

it('omits the footer for an empty collection', () => {
    const { container } = render(<Pagination page={1} pages={1} count={0} onChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
});
