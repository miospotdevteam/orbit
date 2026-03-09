import * as React from 'react';

export interface BlockDiffIndicatorProps {
    /** Whether this block was updated in the last regeneration. */
    isChanged: boolean;
}

export const BlockDiffIndicator: React.FC<BlockDiffIndicatorProps> = ({ isChanged }) => {
    if (!isChanged) return null;

    return (
        <span className="block-diff-indicator" title="Updated in last regeneration">
            changed
        </span>
    );
};
