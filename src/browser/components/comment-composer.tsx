import * as React from 'react';

export interface CommentComposerProps {
    blockId: string;
    onSubmit: (blockId: string, body: string) => void;
    onCancel: () => void;
}

export const CommentComposer: React.FC<CommentComposerProps> = ({ blockId, onSubmit, onCancel }) => {
    const [body, setBody] = React.useState('');
    const textareaRef = React.useRef<HTMLTextAreaElement>(null);

    React.useEffect(() => {
        textareaRef.current?.focus();
    }, []);

    const handleSubmit = (): void => {
        const trimmed = body.trim();
        if (trimmed) {
            onSubmit(blockId, trimmed);
            setBody('');
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent): void => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            handleSubmit();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
        }
    };

    return (
        <div className="comment-composer">
            <textarea
                ref={textareaRef}
                className="comment-composer-input"
                placeholder="Leave a comment"
                value={body}
                onChange={e => setBody(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={3}
            />
            <div className="comment-composer-actions">
                <button className="comment-composer-cancel" onClick={onCancel}>
                    Cancel
                </button>
                <button
                    className="comment-composer-submit"
                    onClick={handleSubmit}
                    disabled={!body.trim()}
                >
                    Add Comment
                </button>
            </div>
        </div>
    );
};
