import { DatePicker } from './date-picker';

export const DateRangePicker = ({
    label,
    from,
    to,
    onFromChange,
    onToChange,
}: {
    label: string;
    from: string;
    to: string;
    onFromChange: (value: string) => void;
    onToChange: (value: string) => void;
}) => (
    <fieldset className="date-range">
        <legend>{label}</legend>
        <label>
            С
            <DatePicker
                label={`${label}, с`}
                value={from}
                max={to}
                onChange={(value) => {
                    if (!value || !to || value <= to) {
                        onFromChange(value);
                    }
                }}
            />
        </label>
        <label>
            По
            <DatePicker
                label={`${label}, по`}
                value={to}
                min={from}
                onChange={(value) => {
                    if (!value || !from || value >= from) {
                        onToChange(value);
                    }
                }}
            />
        </label>
    </fieldset>
);
