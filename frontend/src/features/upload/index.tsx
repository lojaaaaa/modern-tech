import type { DocumentRecord, Resource } from '@/shared/api/types';
import { useRef, useState } from 'react';
import { Upload, X, FileUp, CheckCircle2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { Modal } from '@/shared/ui/modal';
import { Button } from '@/shared/ui/button';
import { ErrorMessage } from '@/shared/ui/error-message';
import { formatBytes } from '@/shared/lib/utils';
interface Result {
    name: string;
    ok: boolean;
    message: string;
}
export const UploadPanel = ({ onClose }: { onClose: () => void }) => {
    const [files, setFiles] = useState<File[]>([]);
    const [busy, setBusy] = useState(false);
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
        if (next.length > 20 || next.some((f) => f.size > 50 * 1024 * 1024 || f.size === 0)) {
            setError('Выберите до 20 непустых файлов, каждый не больше 50 МБ.');
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
                    completed.push({ name: file.name, ok: true, message: 'Существующий документ найден' });
                    setResults([...completed]);
                    continue;
                }
                await api(action === 'version' && match ? `/documents/${match.id}/versions` : '/documents', {
                    method: 'POST',
                    body: data,
                    headers: { 'Idempotency-Key': crypto.randomUUID() },
                });
                completed.push({ name: file.name, ok: true, message: 'Принят на обработку' });
            } catch (e) {
                completed.push({
                    name: file.name,
                    ok: false,
                    message: e instanceof Error ? e.message : 'Ошибка загрузки',
                });
            }
            setResults([...completed]);
        }
        setBusy(false);
        await client.invalidateQueries({ queryKey: ['documents'] });
    };
    return (
        <Modal titleId="upload-title" onClose={onClose} busy={busy}>
            {duplicate && (
                <section className="duplicate-choice">
                    <strong>Такой файл уже есть: {duplicate.title}</strong>
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
            <header>
                <div>
                    <span className="eyebrow">БИБЛИОТЕКА</span>
                    <h2 id="upload-title">Загрузить документы</h2>
                </div>
                <Button variant="ghost" size="icon" aria-label="Закрыть загрузку" onClick={onClose} disabled={busy}>
                    <X size={20} />
                </Button>
            </header>
            <button
                className="dropzone"
                onClick={() => input.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                    e.preventDefault();
                    choose(e.dataTransfer.files);
                }}
                disabled={busy}
            >
                <span className="upload-icon">
                    <FileUp size={28} />
                </span>
                <strong>Перетащите файлы сюда</strong>
                <span>или нажмите, чтобы выбрать</span>
                <small>PDF, Office, текст и изображения · до 50 МБ</small>
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
            <div className="upload-files">
                {files.map((file, i) => (
                    <div key={`${file.name}-${i}`}>
                        <span>{file.name}</span>
                        <small>{formatBytes(file.size)}</small>
                        {results[i] && (
                            <span className={results[i]?.ok ? 'text-success' : 'text-danger'}>
                                {results[i]?.message}
                            </span>
                        )}
                    </div>
                ))}
            </div>
            <footer>
                <Button variant="secondary" onClick={onClose} disabled={busy}>
                    Закрыть
                </Button>
                <Button
                    disabled={!files.length || busy || results.length === files.length}
                    onClick={() => void submit()}
                >
                    {results.length === files.length && files.length ? (
                        <CheckCircle2 size={16} />
                    ) : (
                        <Upload size={16} />
                    )}{' '}
                    {busy ? `Загрузка ${results.length + 1} из ${files.length}` : 'Загрузить'}
                </Button>
            </footer>
        </Modal>
    );
};
