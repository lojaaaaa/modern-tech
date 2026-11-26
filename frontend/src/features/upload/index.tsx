import { Spinner } from '@/shared/ui/spinner';
import { queryKeys } from '@/shared/api/query-keys';
import type { DocumentRecord, Resource } from '@/shared/api/types';
import { useRef, useState } from 'react';
import { Upload, FileUp, CheckCircle2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { Modal } from '@/shared/ui/modal';

import { Button } from '@/shared/ui/button';
import { ErrorMessage } from '@/shared/ui/error-message';
import { formatBytes } from '@/shared/lib/utils';

interface Result {
    name: string;
    isSuccessful: boolean;
    message: string;
}
export const UploadPanel = ({ onClose }: { onClose: () => void }) => {
    const [files, setFiles] = useState<File[]>([]);
    const [isBusy, setBusy] = useState(false);
    const [results, setResults] = useState<Result[]>([]);
    const [error, setError] = useState<string | null>(null);
    const decision = useRef<((value: string) => void) | null>(null);
    const [duplicate, setDuplicate] = useState<DocumentRecord | null>(null);
    const input = useRef<HTMLInputElement>(null);
    const client = useQueryClient();

    const choose = (values: FileList | null) => {
        if (!values) {
            return;
        }
        const next = Array.from(values);
        if (!next.length || next.length > 20 || next.some((f) => f.size > 50 * 1024 * 1024 || f.size === 0)) {
            setError('Выберите от 1 до 20 файлов размером до 50 МБ каждый. Пустые файлы загрузить нельзя.');

            return;
        }
        setFiles(next);
        setError(null);
        setResults([]);
    };

    const submit = async () => {
        setBusy(true);
        const completed: Result[] = [];
        for (const file of files) {
            const data = new FormData();
            data.append('file', file);
            try {
                const matches = await api<Resource<DocumentRecord[]>>('/documents/duplicates', {
                    method: 'POST',
                    body: data,
                });

                const match = matches.data[0];
                let action = 'copy';
                if (match) {
                    setDuplicate(match);
                    action = await new Promise<string>((resolve) => {
                        decision.current = resolve;
                    });
                    setDuplicate(null);
                    decision.current = null;
                }
                if (action === 'open' && match) {
                    completed.push({ name: file.name, isSuccessful: true, message: 'Существующий документ найден' });
                    setResults([...completed]);
                    continue;
                }
                await api(action === 'version' && match ? `/documents/${match.id}/versions` : '/documents', {
                    method: 'POST',
                    body: data,
                    headers: { 'Idempotency-Key': crypto.randomUUID() },
                });
                completed.push({
                    name: file.name,
                    isSuccessful: true,
                    message: 'Загружен. Ожидает проверки и обработки',
                });
            } catch (e) {
                completed.push({
                    name: file.name,
                    isSuccessful: false,
                    message: e instanceof Error ? e.message : 'Ошибка загрузки',
                });
            }
            setResults([...completed]);
        }
        setBusy(false);
        await client.invalidateQueries({ queryKey: [queryKeys.documents] });
    };

    return (
        <Modal titleId="upload-title" closeLabel="Закрыть загрузку" onClose={onClose} isBusy={isBusy}>
            {duplicate && (
                <section className="duplicate-choice">
                    <strong>Файл совпадает с документом «{duplicate.title}»</strong>
                    <div>
                        <Button
                            variant="secondary"
                            size="small"
                            onClick={() => {
                                window.open(`/documents/${duplicate.id}`, '_blank', 'noopener');
                                decision.current?.('open');
                            }}
                        >
                            Открыть существующий
                        </Button>
                        {duplicate.permissions.edit && (
                            <Button size="small" onClick={() => decision.current?.('version')}>
                                Новая версия
                            </Button>
                        )}
                        <Button variant="ghost" size="small" onClick={() => decision.current?.('copy')}>
                            Отдельная копия
                        </Button>
                    </div>
                </section>
            )}
            <h2 id="upload-title">Загрузить документы</h2>
            <button
                className="dropzone"
                onClick={() => input.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                    e.preventDefault();
                    choose(e.dataTransfer.files);
                }}
                disabled={isBusy}
            >
                <span className="upload-icon">
                    <FileUp size={28} />
                </span>
                <strong>Перетащите файлы сюда</strong>
                <span>или нажмите, чтобы выбрать</span>
                <small>До 20 файлов, до 50 МБ каждый: PDF, DOCX, XLSX, PPTX, TXT, MD, CSV, PNG, JPG.</small>
            </button>
            <input
                ref={input}
                type="file"
                multiple
                hidden
                aria-label="Выбрать документы"
                accept=".pdf,.docx,.xlsx,.pptx,.txt,.md,.csv,.png,.jpg,.jpeg"
                onChange={(e) => choose(e.target.files)}
            />
            {error && <ErrorMessage error={new Error(error)} />}
            <div className="upload-files" aria-live="polite" aria-relevant="additions text">
                {files.map((file, i) => (
                    <div key={`${file.name}-${i}`}>
                        <span>{file.name}</span>
                        <small>{formatBytes(file.size)}</small>
                        {results[i] && (
                            <span className={results[i]?.isSuccessful ? 'text-success' : 'text-danger'}>
                                {results[i]?.message}
                            </span>
                        )}
                    </div>
                ))}
            </div>
            {isBusy && !duplicate && (
                <progress
                    className="upload-progress"
                    aria-label="Обработано файлов"
                    max={files.length}
                    value={results.length}
                />
            )}
            <footer>
                <Button variant="secondary" onClick={onClose} disabled={isBusy}>
                    Закрыть
                </Button>
                <Button
                    disabled={!files.length || isBusy || results.length === files.length}
                    onClick={() => void submit()}
                >
                    {isBusy && !duplicate ? (
                        <Spinner />
                    ) : results.length === files.length && files.length ? (
                        <CheckCircle2 size={16} />
                    ) : (
                        <Upload size={16} />
                    )}{' '}
                    {isBusy
                        ? duplicate
                            ? 'Выберите действие для совпавшего файла'
                            : `Загрузка ${Math.min(results.length + 1, files.length)} из ${files.length}`
                        : 'Загрузить'}
                </Button>
            </footer>
        </Modal>
    );
};
