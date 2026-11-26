const escapePattern = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const HighlightedText = ({
    text,
    match,
    offset,
}: {
    text: string;
    match: string;
    offset?: number | undefined;
}) => {
    if (!match) {
        return text;
    }
    if (offset !== undefined) {
        // PostgreSQL reports Unicode character offsets. JS slices use UTF-16.
        const start = [...text].slice(0, offset).join('').length;
        if (text.slice(start, start + match.length) !== match) {
            return text;
        }

        return (
            <>
                {text.slice(0, start)}
                <mark className="search-mark">{match}</mark>
                <HighlightedText text={text.slice(start + match.length)} match={match} />
            </>
        );
    }

    const parts = text.split(new RegExp(`(${escapePattern(match)})`, 'giu'));

    return parts.map((part, index) =>
        index % 2 ? (
            <mark key={index} className="search-mark">
                {part}
            </mark>
        ) : (
            part
        )
    );
};
