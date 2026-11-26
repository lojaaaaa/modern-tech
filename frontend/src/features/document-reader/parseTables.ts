export type PreviewSheet = { name: string; rows: string[][] };

const formatCell = (value: unknown): string => {
    if (value instanceof Date) {
        return value.toLocaleDateString('ru-RU', { timeZone: 'UTC' });
    }
    if (typeof value === 'boolean') {
        return value ? 'Да' : 'Нет';
    }

    return value === null || value === undefined ? '' : String(value);
};

export const parseTables = async (blob: Blob, kind: 'csv' | 'spreadsheet'): Promise<PreviewSheet[]> => {
    if (kind === 'csv') {
        const { default: Papa } = await import('papaparse');
        const result = Papa.parse<string[]>(await blob.text(), { skipEmptyLines: 'greedy' });
        if (result.errors.some((error) => error.code === 'MissingQuotes')) {
            throw new Error('Не удалось прочитать CSV: проверьте кавычки в ячейках.');
        }

        return [{ name: 'Таблица', rows: result.data }];
    }
    try {
        const { default: readExcelFile } = await import('read-excel-file/browser');
        const sheets = await readExcelFile(blob);

        return sheets.map((sheet) => ({ name: sheet.sheet, rows: sheet.data.map((row) => row.map(formatCell)) }));
    } catch {
        throw new Error('Не удалось прочитать таблицу XLSX. Проверьте файл или скачайте его для открытия.');
    }
};
