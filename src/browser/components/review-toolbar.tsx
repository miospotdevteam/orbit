import * as React from 'react';
import { ReviewState } from '../../common/types';

export interface ReviewToolbarProps {
    title: string;
    generatedAt: string | null;
    reviewState: ReviewState;
    isStale: boolean;
    openThreadCount: number;
    onRegenerate: () => void;
    onApprove: () => void;
    onRequestChanges: () => void;
}

const STATE_DOT_CLASS: Record<ReviewState, string> = {
    draft: 'review-state-dot-draft',
    in_review: 'review-state-dot-in_review',
    changes_requested: 'review-state-dot-changes_requested',
    approved: 'review-state-dot-approved',
    stale: 'review-state-dot-stale',
};

const STATE_LABELS: Record<ReviewState, string> = {
    draft: 'Draft',
    in_review: 'In Review',
    changes_requested: 'Changes Requested',
    approved: 'Approved',
    stale: 'Stale',
};

function relativeTime(isoDate: string): string {
    const diff = Date.now() - new Date(isoDate).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `about ${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
}

export const ReviewToolbar: React.FC<ReviewToolbarProps> = ({
    title,
    generatedAt,
    reviewState,
    isStale,
    openThreadCount,
    onRegenerate,
    onApprove,
    onRequestChanges,
}) => {
    const [dropdownOpen, setDropdownOpen] = React.useState(false);
    const dropdownRef = React.useRef<HTMLDivElement>(null);

    // Close dropdown on outside click
    React.useEffect(() => {
        if (!dropdownOpen) return;
        const handleClick = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [dropdownOpen]);

    const timestamp = generatedAt ? relativeTime(generatedAt) : null;

    return (
        <div className="review-toolbar">
            <div className="review-toolbar-left">
                <span className="review-toolbar-title">{title}</span>
                {timestamp && (
                    <span className="review-toolbar-timestamp">{timestamp}</span>
                )}
            </div>
            <div className="review-toolbar-right">
                {openThreadCount > 0 && (
                    <span className="review-toolbar-timestamp">
                        {openThreadCount} open
                    </span>
                )}

                {/* Review dropdown */}
                <div className="review-dropdown" ref={dropdownRef}>
                    <button
                        className="review-dropdown-btn"
                        onClick={() => setDropdownOpen(!dropdownOpen)}
                    >
                        <span className={`review-state-indicator ${STATE_DOT_CLASS[reviewState]}`} />
                        Review
                        <span style={{ fontSize: '0.7em', marginLeft: '2px' }}>&#9662;</span>
                    </button>
                    {dropdownOpen && (
                        <div className="review-dropdown-menu">
                            <div style={{ padding: '6px 14px', fontSize: '0.78em', color: '#888' }}>
                                {STATE_LABELS[reviewState]}
                            </div>
                            <div className="review-dropdown-divider" />
                            <button
                                className="review-dropdown-item"
                                onClick={() => { onRequestChanges(); setDropdownOpen(false); }}
                                disabled={reviewState === 'changes_requested'}
                            >
                                Request Changes
                            </button>
                            {isStale && (
                                <button
                                    className="review-dropdown-item"
                                    onClick={() => { onRegenerate(); setDropdownOpen(false); }}
                                >
                                    Regenerate
                                </button>
                            )}
                        </div>
                    )}
                </div>

                {/* Proceed button */}
                <button
                    className="review-proceed-btn"
                    onClick={onApprove}
                    disabled={reviewState === 'approved'}
                >
                    Proceed
                </button>
            </div>
        </div>
    );
};
