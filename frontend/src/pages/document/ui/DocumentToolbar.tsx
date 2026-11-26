import { Button } from '@/shared/ui/button';
import { Eye, FileText, History, Maximize, MessageSquare, Shield } from 'lucide-react';
import type { useDocumentWorkspace } from '../model/useDocumentWorkspace';

type Props = Omit<
    Pick<
        ReturnType<typeof useDocumentWorkspace>,
        | 'isDiscussionOpen'
        | 'setDiscussionOpen'
        | 'tab'
        | 'setTab'
        | 'isDiscussionVisible'
        | 'setSelectedVersion'
        | 'isExpanded'
        | 'setExpanded'
        | 'd'
        | 'versions'
        | 'selectedVersion'
        | 'isImage'
        | 'text'
        | 'version'
    >,
    'd'
> & { d: NonNullable<ReturnType<typeof useDocumentWorkspace>['d']> };
export const DocumentToolbar = ({
    isDiscussionOpen,
    setDiscussionOpen,
    tab,
    setTab,
    isDiscussionVisible,
    setSelectedVersion,
    isExpanded,
    setExpanded,
    d,
}: Props) => (
    <div className="document-view-toolbar">
        <div className="tabs" role="group" aria-label="Разделы документа">
            {(d.permissions.edit || d.permissions.comment) &&
                /\.docx$/i.test(d.version?.original_name ?? '') &&
                d.version?.status === 'ready' && (
                    <button
                        aria-pressed={tab === 'editor'}
                        className={tab === 'editor' ? 'active' : ''}
                        onClick={() => {
                            setSelectedVersion(null);
                            setTab('editor');
                        }}
                    >
                        Совместная работа
                    </button>
                )}
            <button
                aria-label="Предпросмотр"
                aria-pressed={tab === 'preview'}
                className={tab === 'preview' ? 'active' : ''}
                onClick={() => setTab('preview')}
            >
                <Eye size={16} />
                Просмотр
            </button>
            <button
                aria-label="Текст документа"
                aria-pressed={tab === 'text'}
                className={tab === 'text' ? 'active' : ''}
                onClick={() => setTab('text')}
            >
                <FileText size={16} />
                Текст
            </button>
            <button
                aria-pressed={tab === 'versions'}
                className={tab === 'versions' ? 'active' : ''}
                onClick={() => setTab('versions')}
            >
                <History size={16} />
                Версии
            </button>
            {d.permissions.manage && (
                <button
                    aria-pressed={tab === 'access'}
                    className={tab === 'access' ? 'active' : ''}
                    onClick={() => setTab('access')}
                >
                    <Shield size={16} />
                    Доступ
                </button>
            )}
        </div>
        <div className="document-view-tools">
            {
                <Button
                    variant="secondary"
                    size="small"
                    aria-label="Полноэкранный просмотр"
                    aria-pressed={isExpanded}
                    onClick={() => setExpanded((value) => !value)}
                >
                    <Maximize size={16} />
                    <span className="view-tool-label">{isExpanded ? 'Свернуть' : 'На весь экран'}</span>
                </Button>
            }
            {isDiscussionVisible && (
                <Button
                    variant="secondary"
                    size="small"
                    aria-label="Обсуждение"
                    aria-expanded={isDiscussionOpen}
                    onClick={() => setDiscussionOpen((isOpen) => !isOpen)}
                >
                    <MessageSquare size={16} />
                    <span className="view-tool-label">Обсуждение</span>
                </Button>
            )}
        </div>
    </div>
);
