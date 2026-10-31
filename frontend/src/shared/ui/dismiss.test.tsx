import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DatePicker } from './date-picker';
import { Select } from './select';
it('closes calendar on outside pointer and Escape', () => {
    render(<DatePicker label="Дата" value="2026-10-31" onChange={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: 'Дата' });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.pointerDown(document.body);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
});
it('closes select on option and outside click', () => {
    Element.prototype.scrollIntoView = vi.fn();
    const changed = vi.fn();
    render(<Select label="Тип" value="" onValueChange={changed} options={[{ value: 'pdf', label: 'PDF' }]} />);
    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('option'));
    expect(changed).toHaveBeenCalledWith('pdf');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
});
