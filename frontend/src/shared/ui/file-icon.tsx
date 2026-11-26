import { FileText, Folder, Image } from 'lucide-react';

export const FileIcon = ({
    mime,
    name = '',
    isFolder = false,
}: {
    mime?: string | undefined;
    name?: string;
    isFolder?: boolean;
}) => {
    const isImage = mime?.startsWith('image/') || /\.(png|jpe?g)$/i.test(name);
    const isPdf = mime === 'application/pdf' || /\.pdf$/i.test(name);
    const Icon = isFolder ? Folder : isImage ? Image : FileText;

    return (
        <span
            className={`file-icon ${isFolder ? 'amber' : isImage ? 'purple' : isPdf ? 'red' : 'blue'}`}
            aria-hidden="true"
        >
            <Icon size={18} />
        </span>
    );
};
