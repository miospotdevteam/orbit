import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import { marked } from 'marked';
import { ArtifactBlock, CommentThread, CommentSidecar, ParsedArtifact, ReviewState } from '../common/types';
import { CommentComposer } from '../browser/components/comment-composer';
import { ReviewToolbar } from '../browser/components/review-toolbar';
import { BlockDiffIndicator } from '../browser/components/block-diff-indicator';
import { HostToWebviewMessage, WebviewToHostMessage } from './types';

// Configure marked for GFM rendering
marked.setOptions({ breaks: false, gfm: true });

// Acquire the VS Code API for postMessage
declare function acquireVsCodeApi(): {
    postMessage(message: WebviewToHostMessage | { type: 'ready' }): void;
    getState(): unknown;
    setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

function postAction(message: WebviewToHostMessage): void {
    vscode.postMessage(message);
}

interface AppState {
    artifact: ParsedArtifact | null;
    sidecar: CommentSidecar | null;
    reviewState: ReviewState;
    isStale: boolean;
    changedBlockIds: string[];
    selectedBlockId: string | null;
    composingBlockId: string | null;
}

const App: React.FC = () => {
    const [state, setState] = React.useState<AppState>({
        artifact: null,
        sidecar: null,
        reviewState: 'draft',
        isStale: false,
        changedBlockIds: [],
        selectedBlockId: null,
        composingBlockId: null,
    });

    React.useEffect(() => {
        const handler = (event: MessageEvent<HostToWebviewMessage>) => {
            const message = event.data;
            if (message.type === 'stateUpdate') {
                setState(prev => ({
                    ...prev,
                    artifact: message.artifact,
                    sidecar: message.sidecar,
                    reviewState: message.reviewState,
                    isStale: message.isStale,
                    changedBlockIds: message.changedBlockIds,
                }));
            }
        };

        window.addEventListener('message', handler);
        vscode.postMessage({ type: 'ready' });
        return () => window.removeEventListener('message', handler);
    }, []);

    // Keyboard navigation
    React.useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!state.artifact) return;
            const blocks = state.artifact.blocks;
            if (blocks.length === 0) return;

            const threads = state.sidecar?.threads ?? [];
            const openThreads = threads.filter(t => t.status === 'open');

            switch (e.key) {
                case 'j': {
                    e.preventDefault();
                    const currentIdx = blocks.findIndex(b => b.id === state.selectedBlockId);
                    const nextIdx = currentIdx < blocks.length - 1 ? currentIdx + 1 : 0;
                    setState(prev => ({ ...prev, selectedBlockId: blocks[nextIdx].id }));
                    scrollToBlock(blocks[nextIdx].id);
                    break;
                }
                case 'k': {
                    e.preventDefault();
                    const currentIdx = blocks.findIndex(b => b.id === state.selectedBlockId);
                    const prevIdx = currentIdx > 0 ? currentIdx - 1 : blocks.length - 1;
                    setState(prev => ({ ...prev, selectedBlockId: blocks[prevIdx].id }));
                    scrollToBlock(blocks[prevIdx].id);
                    break;
                }
                case ']': {
                    e.preventDefault();
                    if (openThreads.length === 0) break;
                    const currentBlockIdx = openThreads.findIndex(t => t.blockId === state.selectedBlockId);
                    const nextThread = openThreads[(currentBlockIdx + 1) % openThreads.length];
                    setState(prev => ({ ...prev, selectedBlockId: nextThread.blockId }));
                    scrollToBlock(nextThread.blockId);
                    break;
                }
                case '[': {
                    e.preventDefault();
                    if (openThreads.length === 0) break;
                    const currentBlockIdx = openThreads.findIndex(t => t.blockId === state.selectedBlockId);
                    const prevThread = openThreads[currentBlockIdx > 0 ? currentBlockIdx - 1 : openThreads.length - 1];
                    setState(prev => ({ ...prev, selectedBlockId: prevThread.blockId }));
                    scrollToBlock(prevThread.blockId);
                    break;
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [state.artifact, state.sidecar, state.selectedBlockId]);

    const threads = state.sidecar?.threads ?? [];
    const openCount = threads.filter(t => t.status === 'open').length;

    // Derive title from first block heading or fallback
    const title = state.artifact?.blocks[0]?.heading ?? 'Implementation Plan';
    const generatedAt = state.artifact?.metadata?.generatedAt ?? null;

    if (!state.artifact) {
        return (
            <div className="artifact-review-empty">
                <p>Loading artifact...</p>
            </div>
        );
    }

    return (
        <div className="artifact-review-container">
            <ReviewToolbar
                title={title}
                generatedAt={generatedAt}
                reviewState={state.reviewState}
                isStale={state.isStale}
                openThreadCount={openCount}
                onRegenerate={() => postAction({ type: 'regenerate' })}
                onApprove={() => postAction({ type: 'approve' })}
                onRequestChanges={() => postAction({ type: 'requestChanges' })}
            />
            <div className="artifact-review-layout">
                <div className="artifact-review-main">
                    {state.isStale && (
                        <div className="review-stale-banner">
                            Source has changed since this artifact was generated.
                            <button
                                className="review-stale-regenerate"
                                onClick={() => postAction({ type: 'regenerate' })}
                            >
                                Regenerate
                            </button>
                        </div>
                    )}
                    <div className="artifact-review-blocks">
                        {state.artifact.blocks.map(block =>
                            <Block
                                key={block.id}
                                block={block}
                                threads={threads}
                                isSelected={state.selectedBlockId === block.id}
                                isComposing={state.composingBlockId === block.id}
                                isChanged={state.changedBlockIds.includes(block.id)}
                                onSelect={() => setState(prev => ({ ...prev, selectedBlockId: block.id }))}
                                onStartComment={() => setState(prev => ({ ...prev, composingBlockId: block.id, selectedBlockId: block.id }))}
                                onSubmitComment={(body) => {
                                    postAction({ type: 'addComment', blockId: block.id, body });
                                    setState(prev => ({ ...prev, composingBlockId: null }));
                                }}
                                onCancelComment={() => setState(prev => ({ ...prev, composingBlockId: null }))}
                                onReply={(threadId, body) => postAction({ type: 'reply', threadId, body })}
                                onResolveThread={(threadId) => postAction({ type: 'resolveThread', threadId })}
                            />
                        )}
                    </div>
                    {state.artifact.blocks.length === 0 && (
                        <div className="artifact-review-empty">
                            <p>This artifact contains no reviewable blocks.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

interface BlockProps {
    block: ArtifactBlock;
    threads: CommentThread[];
    isSelected: boolean;
    isComposing: boolean;
    isChanged: boolean;
    onSelect: () => void;
    onStartComment: () => void;
    onSubmitComment: (body: string) => void;
    onCancelComment: () => void;
    onReply: (threadId: string, body: string) => void;
    onResolveThread: (threadId: string) => void;
}

const Block: React.FC<BlockProps> = ({
    block, threads, isSelected, isComposing, isChanged,
    onSelect, onStartComment, onSubmitComment, onCancelComment,
    onReply, onResolveThread,
}) => {
    const blockThreads = threads.filter(t => t.blockId === block.id);
    const hasOpen = blockThreads.some(t => t.status === 'open');
    const threadCount = blockThreads.length;
    const [replyingTo, setReplyingTo] = React.useState<string | null>(null);
    const [showThreads, setShowThreads] = React.useState(hasOpen);

    // Auto-show threads when open threads appear
    React.useEffect(() => {
        if (hasOpen) setShowThreads(true);
    }, [hasOpen]);

    const classes = [
        'artifact-block',
        hasOpen ? 'artifact-block-has-open' : '',
        isSelected ? 'artifact-block-selected' : '',
        isComposing ? 'artifact-block-composing' : '',
        isChanged ? 'artifact-block-changed' : '',
    ].filter(Boolean).join(' ');

    // Render block's rawLines as markdown HTML using marked
    // Content comes from trusted artifact files on disk, not user input
    const markdownHtml = React.useMemo(() => {
        const markdown = block.rawLines.join('\n');
        return marked.parse(markdown) as string;
    }, [block.rawLines]);

    return (
        <div className={classes} data-block-id={block.id} onClick={onSelect}>
            {/* Hover actions */}
            <div className="artifact-block-actions">
                <BlockDiffIndicator isChanged={isChanged} />
                {threadCount > 0 && (
                    <span
                        className={`block-comment-count ${hasOpen ? 'block-comment-count-open' : ''}`}
                        onClick={(e) => { e.stopPropagation(); setShowThreads(!showThreads); }}
                        title={`${threadCount} comment${threadCount === 1 ? '' : 's'}`}
                    >
                        {threadCount}
                    </span>
                )}
                <button
                    className="artifact-block-comment-btn"
                    onClick={(e) => { e.stopPropagation(); onStartComment(); }}
                    title="Add comment"
                >
                    Comment
                </button>
            </div>

            {/* Rendered markdown content — trusted source (artifact file on disk) */}
            <div
                className="artifact-block-content"
                dangerouslySetInnerHTML={{ __html: markdownHtml }}
            />

            {/* Inline threads */}
            {showThreads && blockThreads.length > 0 && (
                <div className="block-inline-threads">
                    {blockThreads.map(thread => (
                        <div key={thread.id} className={`block-inline-thread ${thread.status === 'resolved' ? 'block-inline-thread-resolved' : ''}`}>
                            {thread.comments.map(comment => (
                                <div key={comment.id} className={`block-inline-comment ${comment.author === 'agent' ? 'block-inline-comment-agent' : ''}`}>
                                    <span className="block-inline-comment-author">{comment.author}</span>
                                    <span className="block-inline-comment-body">{comment.body}</span>
                                </div>
                            ))}
                            {thread.status === 'open' && (
                                <div className="block-inline-thread-actions">
                                    <button onClick={(e) => { e.stopPropagation(); setReplyingTo(thread.id); }}>Reply</button>
                                    <button onClick={(e) => { e.stopPropagation(); onResolveThread(thread.id); }}>Resolve</button>
                                </div>
                            )}
                            {replyingTo === thread.id && (
                                <CommentComposer
                                    blockId={block.id}
                                    onSubmit={(_blockId, body) => { onReply(thread.id, body); setReplyingTo(null); }}
                                    onCancel={() => setReplyingTo(null)}
                                />
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Comment composer popover */}
            {isComposing && (
                <div className="comment-popover-anchor">
                    <div className="comment-popover">
                        <CommentComposer
                            blockId={block.id}
                            onSubmit={(_blockId, body) => onSubmitComment(body)}
                            onCancel={onCancelComment}
                        />
                    </div>
                </div>
            )}
        </div>
    );
};


function scrollToBlock(blockId: string): void {
    const el = document.querySelector(`[data-block-id="${blockId}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Mount the React app
const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<App />);
